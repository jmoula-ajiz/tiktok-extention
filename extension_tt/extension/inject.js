(function () {
  const DEBUG_NETWORK = false;

  const originalFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  function isCommentListUrl(url) {
    if (!url || typeof url !== "string") return false;
    return (
      url.includes("/api/comment/list") ||
      url.includes("/aweme/v1/comment/list") ||
      url.includes("/aweme/v2/comment/list") ||
      /comment\/list/.test(url)
    );
  }

  function resolveFetchUrl(input) {
    if (typeof input === "string") {
      if (input.startsWith("http")) return input;
      return location.origin + (input.startsWith("/") ? input : "/" + input);
    }
    if (input instanceof Request) return input.url;
    if (input && typeof input === "object")
      return input.url || input.href || String(input);
    return "";
  }

  function extractAwemeIdFromUrl(url) {
    try {
      const urlObj = new URL(url.startsWith("http") ? url : location.origin + url);
      return (
        urlObj.searchParams.get("aweme_id") ||
        urlObj.searchParams.get("item_id") ||
        urlObj.searchParams.get("video_id") ||
        null
      );
    } catch {
      const m = url.match(/(?:aweme_id|item_id|video_id)=(\d+)/);
      return m ? m[1] : null;
    }
  }

  function pickAwemeIdFromObject(obj) {
    if (!obj || typeof obj !== "object") return null;
    const a =
      obj.aweme_id ??
      obj.item_id ??
      obj.video_id ??
      (Array.isArray(obj.aweme_ids) && obj.aweme_ids.length
        ? obj.aweme_ids[0]
        : null);
    return a != null && a !== "" ? String(a) : null;
  }

  async function extractAwemeIdFromFetchArgs(input, init) {
    try {
      if (init && init.body != null) {
        if (typeof init.body === "string") {
          const j = JSON.parse(init.body);
          const id = pickAwemeIdFromObject(j);
          if (id) return id;
        } else if (
          typeof URLSearchParams !== "undefined" &&
          init.body instanceof URLSearchParams
        ) {
          return (
            init.body.get("aweme_id") ||
            init.body.get("item_id") ||
            init.body.get("video_id") ||
            null
          );
        }
      }
    } catch {
      /* ignore */
    }
    try {
      if (input instanceof Request && input.body) {
        const text = await input.clone().text();
        if (!text) return null;
        const j = JSON.parse(text);
        return pickAwemeIdFromObject(j);
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function parseXhrBodyAweme(body) {
    if (body == null) return null;
    if (typeof body === "string") {
      try {
        return pickAwemeIdFromObject(JSON.parse(body));
      } catch {
        return null;
      }
    }
    return null;
  }

  function normalizeCommentResponse(data) {
    if (!data || typeof data !== "object")
      return { comments: [], hasPayload: false };
    const sc = data.status_code;
    const comments =
      data.comments ||
      data.comment_list ||
      (data.data && data.data.comments) ||
      [];
    const arr = Array.isArray(comments) ? comments : [];
    if (arr.length === 0) return { comments: [], hasPayload: true };
    if (sc != null && sc !== 0 && arr.length === 0)
      return { comments: [], hasPayload: true };
    return { comments: arr, hasPayload: true };
  }

  function mapComment(c) {
    const u = c.user || {};
    let labelList = null;
    if (Array.isArray(c.label_list)) {
      labelList = c.label_list
        .map((x) => (x && typeof x === "object" && x.text ? x.text : null))
        .filter(Boolean)
        .slice(0, 6);
      if (labelList.length === 0) labelList = null;
    }
    return {
      cid: c.cid,
      text: c.text,
      author: u.nickname || "Unknown",
      likes: c.digg_count || 0,
      time: c.create_time,
      comment_language: c.comment_language != null ? c.comment_language : null,
      sort_tags: c.sort_tags != null ? c.sort_tags : null,
      reply_comment_total:
        c.reply_comment_total != null ? c.reply_comment_total : null,
      is_high_purchase_intent: !!c.is_high_purchase_intent,
      label_list: labelList,
      predicted_age_group:
        u.predicted_age_group != null && u.predicted_age_group !== ""
          ? u.predicted_age_group
          : null,
      sort_extra_score: c.sort_extra_score != null ? c.sort_extra_score : null,
      aweme_id: c.aweme_id != null ? String(c.aweme_id) : null,
    };
  }

  function resolveAwemeId(url, comments, bodyAwemeId) {
    return (
      extractAwemeIdFromUrl(url) ||
      bodyAwemeId ||
      (comments[0] && pickAwemeIdFromObject(comments[0])) ||
      (comments[0] && comments[0].aweme_id != null
        ? String(comments[0].aweme_id)
        : null)
    );
  }

  function handleCommentResponse(url, data, bodyAwemeId) {
    const { comments } = normalizeCommentResponse(data);
    if (!comments.length) return;

    const aweme_id = resolveAwemeId(url, comments, bodyAwemeId);
    if (!aweme_id) {
      console.warn("[TikTok Extension] Could not extract aweme_id from:", url);
      return;
    }

    const simplifiedComments = comments.map(mapComment);

    console.log(
      `[TikTok Extension] Intercepted ${simplifiedComments.length} comments for aweme_id=${aweme_id}`,
    );

    window.postMessage(
      {
        type: "TIKTOK_COMMENTS_INTERCEPTED",
        aweme_id,
        comments: simplifiedComments,
      },
      "*",
    );
  }

  window.fetch = async function (...args) {
    const url = resolveFetchUrl(args[0]);
    let bodyAwemeId = null;

    if (url && isCommentListUrl(url)) {
      if (DEBUG_NETWORK) console.debug("[TikTok Extension] fetch comment URL:", url);
      try {
        bodyAwemeId = await extractAwemeIdFromFetchArgs(args[0], args[1] || {});
      } catch {
        /* ignore */
      }
    }

    const response = await originalFetch.apply(this, args);

    if (url && isCommentListUrl(url)) {
      try {
        const cloned = response.clone();
        cloned
          .json()
          .then((data) => handleCommentResponse(url, data, bodyAwemeId))
          .catch((err) =>
            console.error("[TikTok Extension] comment JSON parse", err),
          );
      } catch (err) {
        console.error("[TikTok Extension] comment clone", err);
      }
    }

    return response;
  };

  XMLHttpRequest.prototype.open = function (...args) {
    this._url = args[1];
    return originalXhrOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const body = args[0];
    let aweme = null;
    try {
      const u = this._url;
      if (typeof u === "string" && isCommentListUrl(u)) {
        aweme = parseXhrBodyAweme(body);
      }
    } catch {
      /* ignore */
    }
    this._commentBodyAweme = aweme;

    this.addEventListener("load", function () {
      let url = "";
      if (typeof this._url === "string") {
        url = this._url;
      } else if (this._url && typeof this._url === "object") {
        url = this._url.url || this._url.href || this._url.toString();
      }

      if (url && typeof url === "string" && url.includes("comment")) {
        if (DEBUG_NETWORK)
          console.debug("[TikTok Extension] XHR comment URL:", url);
      }

      if (isCommentListUrl(url)) {
        try {
          const data = JSON.parse(this.responseText);
          handleCommentResponse(url, data, this._commentBodyAweme);
        } catch (err) {
          console.error("[TikTok Extension] XHR comment JSON", err);
        }
      }
    });
    return originalXhrSend.apply(this, args);
  };

  console.log("[TikTok Extension] Fetch & XHR Interceptor injected successfully.");
})();
