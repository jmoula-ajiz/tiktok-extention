(() => {

  // ── Comment Cache & Listener ─────────────────────────────────────────────
  const commentCache = {};

  window.addEventListener("message", (event) => {
    if (event.data?.type === "TIKTOK_COMMENTS_INTERCEPTED") {
      const { aweme_id, comments } = event.data;
      if (!aweme_id) return;

      commentCache[aweme_id] = comments;
      console.log(`[TikTok Extension] Cached ${comments.length} comments for aweme_id=${aweme_id}`);

      // Retroactively update storage.
      // FIX: also match when the stored videoId came from a src/link that equals aweme_id,
      // OR when the stored videoId is a timestamp fallback (we treat any mismatch as
      // "needs updating" if the item has no commentsData yet AND the capture timestamp
      // is recent — within 30 s — meaning it was just captured for this video).
      chrome.storage.local.get({ current: null, history: [] }, (res) => {
        let updated = false;

        const matchesVideo = (item) =>
          item &&
          (item.videoId === aweme_id ||
            (/^\d{13}$/.test(item.videoId) &&
              Date.now() - new Date(item.capturedAt).getTime() < 60_000));

        if (matchesVideo(res.current)) {
          res.current.commentsData = comments;
          if (res.current.videoId !== aweme_id) res.current.videoId = aweme_id;
          updated = true;
        }

        res.history.forEach((item) => {
          if (matchesVideo(item)) {
            item.commentsData = comments;
            if (item.videoId !== aweme_id) item.videoId = aweme_id;
            updated = true;
          }
        });

        if (updated) {
          chrome.storage.local.set({ current: res.current, history: res.history });
        }
      });
    }
  });

  // ── State ─────────────────────────────────────────────────────────────────
  let lastCapturedVideoId = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function parseCount(str) {
    if (!str) return null;
    str = str.replace(/,/g, "").trim();
    if (/^\d+$/.test(str)) return parseInt(str);
    const m = str.match(/([\d.]+)\s*([KMB]?)/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const s = m[2].toUpperCase();
    if (s === "K") return Math.round(n * 1000);
    if (s === "M") return Math.round(n * 1000000);
    if (s === "B") return Math.round(n * 1000000000);
    return Math.round(n);
  }

  function getText(el, selectors) {
    for (const sel of selectors) {
      const node = el.querySelector(sel);
      if (node && node.textContent.trim()) return node.textContent.trim();
    }
    return null;
  }

  function getAttr(el, selectors, attr) {
    for (const sel of selectors) {
      const node = el.querySelector(sel);
      if (node && node.getAttribute(attr)) return node.getAttribute(attr);
    }
    return null;
  }

  // ── FIX: robust video-ID extraction ───────────────────────────────────────
  // Priority order:
  //  1. Current page URL  (single-video pages like /@user/video/ID)
  //  2. <a href> links inside the container pointing to /video/ID  ← NEW, most
  //     reliable on FYP where the page URL has no video ID
  //  3. data-aweme-id attribute on the container or its descendants  ← NEW
  //  4. CDN URL embedded in the <video> src
  //  5. Last resort: timestamp (will be corrected once comments arrive)
  function extractVideoId(root, vidEl) {
    // 1. URL path
    const fromUrl = location.pathname.match(/\/video\/(\d+)/)?.[1];
    if (fromUrl) return fromUrl;

    // 2. <a href="/…/video/ID"> links in the container
    if (root && root !== document) {
      const links = root.querySelectorAll('a[href*="/video/"]');
      for (const a of links) {
        const m = (a.getAttribute("href") || "").match(/\/video\/(\d+)/);
        if (m) return m[1];
      }
    }
    // Also scan document-level links when we're on a single-video page
    if (root === document) {
      const links = document.querySelectorAll('a[href*="/video/"]');
      for (const a of links) {
        const m = (a.getAttribute("href") || "").match(/\/video\/(\d+)/);
        if (m) return m[1];
      }
    }

    // 3. data-aweme-id attribute
    if (root && root !== document) {
      const withId =
        root.querySelector("[data-aweme-id]") ||
        root.closest?.("[data-aweme-id]");
      if (withId) return withId.getAttribute("data-aweme-id");
    }

    // 4. CDN video src  (e.g. /video/tos/.../7xxxxxxxxxxxxxxxxx_nuvid.mp4)
    //    Must be a real URL, not a blob:
    if (vidEl && vidEl.src && !vidEl.src.startsWith("blob:")) {
      const m = vidEl.src.match(/\/(\d{15,})/);
      if (m) return m[1];
    }
    // Also try currentSrc (for <source> elements)
    if (vidEl && vidEl.currentSrc && !vidEl.currentSrc.startsWith("blob:")) {
      const m = vidEl.currentSrc.match(/\/(\d{15,})/);
      if (m) return m[1];
    }

    // 5. Timestamp fallback (will be patched when comments arrive)
    return String(Date.now());
  }

  // ── Find the feed-item container for a <video> element ────────────────────
  const CONTAINER_SELECTORS = [
    '[data-e2e="recommend-list-item-container"]',
    '[data-e2e="video-item"]',
    '[class*="DivItemContainer"]',
    '[class*="ItemContainer"]',
    '[class*="video-feed-item"]',
  ];

  function findVideoContainer(videoEl) {
    let el = videoEl;
    while (el && el !== document.body) {
      for (const sel of CONTAINER_SELECTORS) {
        if (el.matches?.(sel)) return el;
      }
      el = el.parentElement;
    }

    const ancestor = videoEl.closest('[class*="Container"]');
    if (ancestor) {
      const hasAuthor = ancestor.querySelector(
        '[data-e2e*="username"], [data-e2e*="uniqueid"], [class*="AuthorTitle"]'
      );
      if (hasAuthor) return ancestor;
    }

    return document;
  }

  // ── Extractor ──────────────────────────────────────────────────────────────

  function extractVideoData(root) {
    root = root || document;

    // Caption & hashtags
    const captionEl =
      root.querySelector('[data-e2e="browse-video-desc"]') ||
      root.querySelector('[data-e2e="video-desc"]') ||
      root.querySelector('[class*="SpanText"]') ||
      root.querySelector('[class*="video-meta-caption"]');

    const captionText = captionEl ? captionEl.textContent.trim() : "";

    const hashtagEls = captionEl
      ? [...captionEl.querySelectorAll('a[href*="/tag/"], a[href*="/search?"]')]
      : [...(root.querySelectorAll
          ? root.querySelectorAll('a[href*="/tag/"]')
          : [])];

    const hashtags = [
      ...new Set(
        hashtagEls
          .map((a) => a.textContent.trim().replace(/^#/, ""))
          .filter(Boolean)
      ),
    ];

    // Stats
    const likeCount = parseCount(
      getAttr(root,
        ['[data-e2e="browse-like-count"]', '[data-e2e="like-count"]'],
        "aria-label"
      ) ||
        getText(root, [
          '[data-e2e="browse-like-count"]',
          '[data-e2e="like-count"]',
          '[class*="LikeCount"]',
        ])
    );

    const commentCount = parseCount(
      getText(root, [
        '[data-e2e="browse-comment-count"]',
        '[data-e2e="comment-count"]',
        '[class*="CommentCount"]',
      ])
    );

    const shareCount = parseCount(
      getText(root, [
        '[data-e2e="browse-share-count"]',
        '[data-e2e="share-count"]',
        '[class*="ShareCount"]',
      ])
    );

    const saveCount = parseCount(
      getText(root, [
        '[data-e2e="undefined-count"]',
        '[data-e2e="collect-count"]',
        '[class*="CollectCount"]',
      ])
    );

    // Author
    const NAV_LABELS = new Set([
      "profile", "home", "explore", "live", "messages", "inbox", "following",
    ]);

    function findCreatorAnchor(anchors) {
      return anchors.find((a) => {
        const text = a.textContent.trim();
        if (!text || NAV_LABELS.has(text.toLowerCase())) return false;
        if (
          a.closest(
            'nav, [class*="SideBar"], [class*="sidebar"], [class*="NavBar"], [class*="navbar"], [data-e2e="nav"]'
          )
        )
          return false;
        return true;
      });
    }

    const authorUsername =
      getText(root, [
        '[data-e2e="browse-username"]',
        '[data-e2e="video-author-uniqueid"]',
        '[data-e2e="author-uniqueid"]',
        '[class*="AuthorTitle"]',
        '[class*="author-uniqueId"]',
        '[class*="UniqueId"]',
      ]) ||
      (() => {
        const anchors = [...root.querySelectorAll('a[href*="/@"]')];
        const a = findCreatorAnchor(anchors);
        return a?.getAttribute("href")?.split("/@")[1]?.split("?")[0] || null;
      })() ||
      location.pathname.split("/@")[1]?.split("/")[0];

    const authorNickname =
      getText(root, [
        '[data-e2e="browse-nickname"]',
        '[data-e2e="video-author-nickname"]',
        '[data-e2e="author-nickname"]',
        '[class*="AuthorNickname"]',
        '[class*="NickName"]',
        '[class*="nickname"]',
      ]) ||
      (() => {
        const anchors = [...root.querySelectorAll('a[href*="/@"]')];
        const a = findCreatorAnchor(anchors);
        return a ? a.textContent.trim() : null;
      })();

    // Audio
    const audioName =
      getText(root, [
        '[data-e2e="browse-music"]',
        '[data-e2e="video-music"]',
        '[class*="MusicName"]',
      ]) || getAttr(root, ['[data-e2e="browse-music"]'], "title");

    // Video element
    const vidEl = root.querySelector("video");
    const duration = vidEl?.duration ? Math.round(vidEl.duration) : null;

    // Format flags
    const isDuet =
      captionText.toLowerCase().includes("#duet") ||
      !!root.querySelector('[class*="duet"]');
    const isStitch =
      captionText.toLowerCase().includes("#stitch") ||
      !!root.querySelector('[class*="stitch"]');
    const isAd =
      !!root.querySelector('[data-e2e="ad-divider"]') ||
      !!root.querySelector('[class*="isAd"]');

    // Date
    const postedAt = getText(root, [
      '[data-e2e="browser-nickname"] span:last-child',
      '[class*="SpanOtherInfos"]',
    ]);

    // Computed
    const engagement =
      (likeCount || 0) + (commentCount || 0) + (shareCount || 0);
    const likeCommentRatio =
      likeCount && commentCount
        ? parseFloat((likeCount / commentCount).toFixed(1))
        : null;

    // FIX: use the new robust extractor instead of the old one-liner
    const videoId = extractVideoId(root, vidEl);

    // URL-based username fallback
    const usernameFromUrl =
      location.pathname.split("/@")[1]?.split("/")[0] || null;
    const finalUsername = authorUsername || usernameFromUrl;
    const finalNickname = authorNickname || finalUsername;

    return {
      videoId,
      capturedAt: new Date().toISOString(),
      url: location.href,
      author: { username: finalUsername, nickname: finalNickname },
      caption: captionText.slice(0, 300),
      hashtags,
      stats: {
        likes: likeCount,
        comments: commentCount,
        shares: shareCount,
        saves: saveCount,
      },
      computed: { engagement, likeCommentRatio },
      audio: audioName,
      duration,
      format: { isDuet, isStitch, isAd },
      postedAt,
    };
  }

  // ── SSR comment extraction ─────────────────────────────────────────────────
  function extractSSRComments(aweme_id) {
    try {
      let textData = [];

      const sigi = document.getElementById("SIGI_STATE");
      if (sigi) textData.push(sigi.textContent);

      const uni = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
      if (uni) textData.push(uni.textContent);

      if (textData.length === 0) {
        const scripts = document.querySelectorAll("script");
        for (const s of scripts) {
          if (
            s.textContent &&
            (s.textContent.includes("CommentItem") ||
              s.textContent.includes("webapp.comment"))
          ) {
            textData.push(s.textContent);
          }
        }
      }

      if (textData.length === 0) return null;

      const foundComments = [];
      for (const text of textData) {
        const regex =
          /"cid":"(\d{15,})".*?"text":"([^"\\]*(?:\\.[^"\\]*)*)".*?(?:"digg_count":(\d+)|"create_time":(\d+))/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          foundComments.push({
            cid: match[1],
            text: match[2],
            author: "TikTok User",
            likes: parseInt(match[3]) || 0,
            time: parseInt(match[4]) || 0,
          });
        }
      }

      const unique = [];
      const seen = new Set();
      for (const c of foundComments) {
        if (!seen.has(c.cid)) {
          seen.add(c.cid);
          unique.push(c);
        }
      }

      if (unique.length > 0) return unique.slice(0, 50);
    } catch (e) {
      console.error("[TikTok Extension] SSR Parsing error:", e);
    }
    return null;
  }

  // ── Store captured data ────────────────────────────────────────────────────

  function storeCapture(data) {
    if (data.videoId === lastCapturedVideoId) return;
    lastCapturedVideoId = data.videoId;

    // Attach comments: check cache by videoId first, then by any 19-digit ID
    // that might be in the cache (handles the case where comments arrived
    // before the video was captured with the correct ID).
    if (commentCache[data.videoId]) {
      data.commentsData = commentCache[data.videoId];
    } else {
      // SSR fallback
      data.commentsData = extractSSRComments(data.videoId) || null;
      if (data.commentsData) {
        commentCache[data.videoId] = data.commentsData;
      }
    }

    chrome.storage.local.get({ history: [] }, (res) => {
      const history = res.history.filter((v) => v.videoId !== data.videoId);
      history.unshift(data);
      chrome.storage.local.set({
        current: data,
        history: history.slice(0, 50),
      });
    });
  }

  // ── Capture from a specific <video> element ────────────────────────────────

  function captureFromVideoEl(videoEl) {
    const container = findVideoContainer(videoEl);
    const data = extractVideoData(container);
    storeCapture(data);
  }

  // ── Capture the currently visible/playing video ────────────────────────────

  function captureCurrentVideo() {
    const videos = document.querySelectorAll("video");
    let playingVideo = null;
    for (const v of videos) {
      if (!v.paused) {
        playingVideo = v;
        break;
      }
    }
    if (!playingVideo) playingVideo = videos[0];
    if (!playingVideo) {
      const data = extractVideoData(document);
      storeCapture(data);
      return;
    }
    captureFromVideoEl(playingVideo);
  }

  // ── Video play detection ───────────────────────────────────────────────────
  let captureTimer = null;

  document.addEventListener(
    "play",
    (e) => {
      if (e.target.tagName !== "VIDEO") return;
      clearTimeout(captureTimer);
      // FIX: increased debounce slightly to 500ms so TikTok has time to set
      // the video src (or update data attributes) before we read them.
      captureTimer = setTimeout(() => {
        captureFromVideoEl(e.target);
      }, 500);
    },
    true
  );

  // ── Fallback initial capture ───────────────────────────────────────────────
  setTimeout(() => {
    if (!lastCapturedVideoId) {
      captureCurrentVideo();
    }
  }, 2500);

  // ── Listen for popup's "captureNow" ping ──────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "captureNow") {
      lastCapturedVideoId = null;
      captureCurrentVideo();
      sendResponse({ ok: true });
    }
    return false;
  });
})();