function fmt(n) {
  if (n === null || n === undefined) return "-";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function fmtDuration(s) {
  if (!s) return null;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ":" + String(sec).padStart(2, "0");
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function engLabel(ratio) {
  if (ratio === null || ratio === undefined) return { text: "-", cls: "" };
  if (ratio > 100) return { text: ratio + "x  VIRAL", cls: "green" };
  if (ratio > 30) return { text: ratio + "x  hot", cls: "green" };
  if (ratio > 10) return { text: ratio + "x", cls: "" };
  return { text: ratio + "x  divisive", cls: "red" };
}

// ── Heuristics (rule-based nutrition signals) ────────────────────────────────
const KEYWORD_OUTRAGE =
  /\b(hate|worst|rage|angry|liar|fake news|destroy|disgusting|pathetic|idiot|trash)\b/i;
const KEYWORD_ANXIETY =
  /\b(worry|worried|anxious|anxiety|scared|terrifying|disaster|crisis|can't cope)\b/i;
const KEYWORD_CLICKBAIT =
  /\b(you won't believe|shocking|secret|exposed|gone wrong|watch till|part \d+)\b/i;

function countEmojis(s) {
  if (!s) return 0;
  try {
    const m = s.match(/\p{Extended_Pictographic}/gu);
    return m ? m.length : 0;
  } catch {
    return 0;
  }
}

function capsWordRatio(s) {
  if (!s) return 0;
  const words = s.split(/\s+/).filter((w) => /^[A-Za-z]{2,}$/.test(w));
  if (!words.length) return 0;
  const caps = words.filter((w) => w === w.toUpperCase()).length;
  return caps / words.length;
}

function heuristicVideoTags(v) {
  const pills = [];
  const cap = (v.caption || "").slice(0, 500);
  const blob = (
    cap +
    " " +
    (v.hashtags || []).join(" ") +
    " " +
    (v.commentsData || [])
      .slice(0, 8)
      .map((c) => c.text || "")
      .join(" ")
  ).slice(0, 2000);

  if (KEYWORD_OUTRAGE.test(blob))
    pills.push({ label: "Strong reaction words", cls: "pill-warn" });
  if (KEYWORD_ANXIETY.test(blob))
    pills.push({ label: "Worry / stress cues", cls: "pill-anxiety" });
  if (KEYWORD_CLICKBAIT.test(blob))
    pills.push({ label: "Clickbait phrasing", cls: "pill-click" });
  if (countEmojis(cap) >= 6) pills.push({ label: "High emoji density", cls: "pill-info" });
  if (capsWordRatio(cap) > 0.25)
    pills.push({ label: "Heavy caps in caption", cls: "pill-info" });

  const langs = {};
  for (const c of v.commentsData || []) {
    const lg = c.comment_language;
    if (lg && lg !== "un") langs[lg] = (langs[lg] || 0) + 1;
  }
  const nLang = Object.keys(langs).length;
  if (nLang >= 3) pills.push({ label: "Mixed comment languages", cls: "pill-good" });

  return pills;
}

function computeSessionInsights(history) {
  const h = history || [];
  if (!h.length) return null;

  const creators = new Set();
  let ads = 0;
  const ratios = [];
  let noComments = 0;
  let purchaseIntentComments = 0;
  const tagCounts = {};
  let tagInstances = 0;

  for (const v of h) {
    const u = v.author?.username || "";
    if (u) creators.add(u);
    if (v.format?.isAd) ads++;
    const r = v.computed?.likeCommentRatio;
    if (r != null && !Number.isNaN(r)) ratios.push(r);
    const cd = v.commentsData;
    if (!cd || !cd.length) noComments++;
    else {
      purchaseIntentComments += cd.filter((c) => c.is_high_purchase_intent).length;
    }
    for (const t of v.hashtags || []) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
      tagInstances++;
    }
  }

  let maxStreak = 0;
  let streak = 0;
  let last = null;
  for (const v of h) {
    const u = v.author?.username || "";
    if (u && u === last) streak++;
    else streak = u ? 1 : 0;
    last = u || last;
    maxStreak = Math.max(maxStreak, streak);
  }

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  const uniqueTags = Object.keys(tagCounts).length;
  const diversity =
    tagInstances > 0 ? (uniqueTags / Math.max(tagInstances, 1)).toFixed(2) : "—";

  let clustering = "low";
  if (topTags[0] && topTags[0].count >= Math.ceil(h.length * 0.4))
    clustering = "high hashtag repeat";
  else if (maxStreak >= 3) clustering = "same creator streak";

  return {
    videoCount: h.length,
    uniqueCreators: creators.size,
    pctAds: ((ads / h.length) * 100).toFixed(0),
    avgLikeCommentRatio:
      ratios.length > 0
        ? (ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(1)
        : "—",
    pctNoCommentData: ((noComments / h.length) * 100).toFixed(0),
    topHashtags: topTags,
    hashtagDiversityIndex: diversity,
    maxCreatorStreak: maxStreak,
    clusteringLabel: clustering,
    purchaseIntentComments,
  };
}

function renderNutritionSession(insights) {
  if (!insights) {
    return `
    <div class="nutrition-section">
      <div class="section-header nutrition-head">
        <span class="section-title">SESSION NUTRITION</span>
      </div>
      <div class="nutrition-body empty-nut">Scroll to capture videos for session stats.</div>
    </div>`;
  }

  const top = insights.topHashtags
    .map((x) => `<span class="nut-tag">#${escHtml(x.tag)} ×${x.count}</span>`)
    .join(" ");

  return `
  <div class="nutrition-section">
    <div class="section-header nutrition-head">
      <span class="section-title">SESSION NUTRITION</span>
    </div>
    <div class="nutrition-body">
      <div class="nut-grid">
        <div class="nut-cell"><span class="nut-k">Videos</span><span class="nut-v">${insights.videoCount}</span></div>
        <div class="nut-cell"><span class="nut-k">Creators</span><span class="nut-v">${insights.uniqueCreators}</span></div>
        <div class="nut-cell"><span class="nut-k">Ads %</span><span class="nut-v">${insights.pctAds}%</span></div>
        <div class="nut-cell"><span class="nut-k">Avg L/C</span><span class="nut-v">${insights.avgLikeCommentRatio}</span></div>
      </div>
      <div class="nut-row"><span class="nut-k">No comment sample</span><span class="nut-v">${insights.pctNoCommentData}%</span></div>
      <div class="nut-row"><span class="nut-k">Tag diversity</span><span class="nut-v">${insights.hashtagDiversityIndex}</span></div>
      <div class="nut-row"><span class="nut-k">Creator streak (max)</span><span class="nut-v">${insights.maxCreatorStreak}</span></div>
      <div class="nut-row"><span class="nut-k">Purchase-intent comments (sample)</span><span class="nut-v">${insights.purchaseIntentComments ?? 0}</span></div>
      <div class="nut-cluster">Clustering signal (heuristic): ${escHtml(insights.clusteringLabel)}</div>
      ${top ? `<div class="nut-top">${top}</div>` : ""}
      <p class="nut-disclaimer">Inferred from visible metadata only — not TikTok’s internal ranking.</p>
    </div>
  </div>`;
}

function renderFriction() {
  return `
  <div class="friction-section">
    <div class="section-header nutrition-head">
      <span class="section-title">FRICTION (USER ACTION)</span>
    </div>
    <div class="friction-body">
      <div class="friction-row">
        <button type="button" class="friction-btn" id="breakBtn">2 min break</button>
        <button type="button" class="friction-btn friction-btn-2" id="exploreBtn">Calm topic search</button>
      </div>
      <div id="breakTimer" class="break-timer hidden"></div>
      <p class="friction-hint">Timers and search links do not change TikTok’s server-side algorithm — they help you pause or explore on purpose.</p>
    </div>
  </div>`;
}

function renderAiPanel() {
  return `
  <div class="ai-section">
    <div class="section-header nutrition-head">
      <span class="section-title">GEMINI (LOCAL BRIDGE)</span>
    </div>
    <div class="ai-body">
      <div id="bridgeStatus" class="bridge-status">Checking bridge…</div>
      <label class="ai-label">Bridge host</label>
      <input type="text" class="ai-input" id="bridgeHost" value="127.0.0.1" autocomplete="off" />
      <label class="ai-label">Port</label>
      <input type="text" class="ai-input" id="bridgePort" value="8787" autocomplete="off" />
      <button type="button" class="ai-run-btn" id="analyzeBtn">Analyze with Gemini</button>
      <button type="button" class="ai-secondary-btn" id="heuristicBtn">Offline heuristics only</button>
      <div id="aiStatus" class="ai-status"></div>
      <div id="aiResultsContainer" class="ai-results-container hidden"></div>
      <p class="ai-disclaimer">Bridge matches <code>gemini.py</code> (empty Cookie header). Run uvicorn from <code>server</code>. Unofficial endpoint — not endorsed by Google.</p>
    </div>
  </div>`;
}

function collectVideoSlice(current, history) {
  const slice = [];
  if (current) slice.push(current);
  for (const v of history || []) {
    if (slice.length >= 15) break;
    if (current && v.videoId === current.videoId) continue;
    slice.push(v);
  }
  return slice;
}

function videoToApiPayload(v) {
  const comments = v.commentsData || [];
  const purchase_intent = comments.filter((c) => c.is_high_purchase_intent).length;
  const langs = [
    ...new Set(comments.map((c) => c.comment_language).filter(Boolean)),
  ];
  const snippets = comments
    .slice(0, 14)
    .map((c) => (c.text || "").slice(0, 140))
    .filter(Boolean)
    .join(" | ");
  return {
    video_id: v.videoId,
    author: v.author?.username || v.author?.nickname || null,
    caption: v.caption || "",
    hashtags: v.hashtags || [],
    stats: v.stats || {},
    is_ad: !!(v.format && v.format.isAd),
    comments_summary: snippets || null,
    purchase_intent_comments: purchase_intent,
    comment_languages: langs,
  };
}

const SCAM_HINTS =
  /\b(dm me|whatsapp|telegram|cashapp|investment|crypto|giveaway winner|click link in bio|double your|earn \$\d)\b/i;

function levelFromScore(score) {
  if (score >= 0.66) return "high";
  if (score >= 0.33) return "medium";
  return "low";
}

function computeOfflineHeuristics(current, history) {
  const slice = collectVideoSlice(current, history);
  if (!slice.length) return null;

  const topics = new Set();
  let outrageHits = 0;
  let scamHits = 0;
  let purchaseComments = 0;
  let shortCaption = 0;
  let ads = 0;

  for (const v of slice) {
    (v.hashtags || []).slice(0, 6).forEach((t) => topics.add("#" + t));
    const blob =
      ((v.caption || "") +
        " " +
        (v.commentsData || [])
          .slice(0, 8)
          .map((c) => c.text || "")
          .join(" ")) ||
      "";
    if (KEYWORD_OUTRAGE.test(blob)) outrageHits++;
    if (SCAM_HINTS.test(blob)) scamHits++;
    purchaseComments += (v.commentsData || []).filter(
      (c) => c.is_high_purchase_intent,
    ).length;
    if ((v.caption || "").length > 0 && (v.caption || "").length < 25)
      shortCaption++;
    if (v.format && v.format.isAd) ads++;
  }

  const n = slice.length;
  const arousal = levelFromScore(outrageHits / n);
  const scam = levelFromScore(scamHits / n);
  const purchase = levelFromScore(
    Math.min(1, purchaseComments / Math.max(8, n * 3)),
  );
  const lowValue = levelFromScore(
    (shortCaption / n) * 0.5 + (topics.size < 3 ? 0.3 : 0),
  );

  return {
    heuristic_only: true,
    topics: [...topics].slice(0, 5),
    arousal_level: arousal,
    clustering_note:
      topics.size <= 2
        ? "Hashtag/caption variety looks narrow in this slice (heuristic)."
        : "Mixed tags across videos (heuristic).",
    transparency_disclaimer:
      "Based only on locally captured captions, hashtags, and comment samples — not TikTok internals.",
    suggested_action:
      scam === "high" || purchase === "high"
        ? "Pause before engaging with money or off-platform links."
        : "If the feed feels repetitive, try search or Following intentionally.",
    low_value_likelihood: lowValue,
    mature_or_sensitive_themes: "low",
    scam_or_deceptive_signals: scam,
    purchase_or_sales_pressure: purchase,
  };
}

function readBridgeSettings(cb) {
  chrome.storage.local.get(
    { geminiBridgeHost: "127.0.0.1", geminiBridgePort: "8787" },
    cb,
  );
}

function saveBridgeInputs(hostEl, portEl) {
  chrome.storage.local.set({
    geminiBridgeHost: (hostEl?.value || "127.0.0.1").trim() || "127.0.0.1",
    geminiBridgePort: (portEl?.value || "8787").trim() || "8787",
  });
}

function pingBridge(host, port, el) {
  if (!el) return;
  chrome.runtime.sendMessage(
    { type: "geminiHealth", host, port },
    (res) => {
      if (chrome.runtime.lastError) {
        el.textContent = "Bridge: unreachable (extension error)";
        return;
      }
      if (!res || !res.ok) {
        el.textContent =
          "Bridge: offline — start: python -m uvicorn main:app --host 127.0.0.1 --port " +
          port;
        return;
      }
      el.textContent = "Bridge: online (same as gemini.py — no cookie config)";
    },
  );
}

function formatBridgeDetail(data) {
  if (data == null) return "";
  const d = data.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((item) => {
        if (item && typeof item === "object" && item.msg != null)
          return String(item.msg);
        return JSON.stringify(item);
      })
      .join(" ");
  }
  if (d != null && typeof d === "object") return JSON.stringify(d);
  return "";
}

function formatBridgeErrorResponse(res) {
  if (!res) return "Unknown error";
  if (res.error) return String(res.error);
  const fromData = formatBridgeDetail(res.data);
  if (fromData) return fromData;
  if (res.status) return "HTTP " + res.status;
  return "Bridge error";
}

/** Survives full `render()` rebuilds when storage updates (scroll) wipe `main.innerHTML`. */
let lastAiResultsHtml = null;

function showAiResults(html) {
  lastAiResultsHtml = html;
  const el = document.getElementById("aiResultsContainer");
  if (!el) return;
  el.innerHTML = html;
  el.classList.remove("hidden");
}

function hideAiResults() {
  lastAiResultsHtml = null;
  const el = document.getElementById("aiResultsContainer");
  if (!el) return;
  el.innerHTML = "";
  el.classList.add("hidden");
}

function restoreAiResultsIfAny() {
  if (lastAiResultsHtml == null) return;
  const el = document.getElementById("aiResultsContainer");
  if (!el) return;
  el.innerHTML = lastAiResultsHtml;
  el.classList.remove("hidden");
}

function renderTopicChips(topics) {
  if (!Array.isArray(topics) || !topics.length) return "";
  return `<div class="ai-topic-row">${topics
    .map((t) => `<span class="topic-chip">${escHtml(String(t))}</span>`)
    .join("")}</div>`;
}

function renderParsedBlock(title, p, opts) {
  const offline = !!(opts && opts.offline);
  const badge = offline
    ? '<span class="ai-badge ai-badge-offline">Offline rules</span>'
    : '<span class="ai-badge ai-badge-gemini">Model</span>';
  let h = `<div class="ai-analysis-card ${offline ? "ai-offline-card" : "ai-gemini-card"}">`;
  h += `<div class="ai-card-head"><span class="ai-card-title">${escHtml(title)}</span> ${badge}</div>`;
  h += renderTopicChips(p.topics);
  const rows = [
    ["arousal_level", "Arousal"],
    ["low_value_likelihood", "Low value"],
    ["mature_or_sensitive_themes", "Sensitive themes"],
    ["scam_or_deceptive_signals", "Scam / deceptive"],
    ["purchase_or_sales_pressure", "Purchase pressure"],
  ];
  for (const [k, lab] of rows) {
    if (p[k] == null || p[k] === "") continue;
    h += `<div class="ai-metric-row"><span class="ai-metric-k">${escHtml(lab)}</span><span class="ai-metric-v">${escHtml(String(p[k]))}</span></div>`;
  }
  if (p.clustering_note)
    h += `<p class="ai-card-p">${escHtml(p.clustering_note)}</p>`;
  if (p.transparency_disclaimer)
    h += `<p class="ai-card-p ai-card-muted">${escHtml(p.transparency_disclaimer)}</p>`;
  if (p.suggested_action)
    h += `<p class="ai-card-p ai-card-action">${escHtml(p.suggested_action)}</p>`;
  h += "</div>";
  return h;
}

function wrapRawDetails(label, obj) {
  const json = JSON.stringify(obj, null, 2);
  return `<details class="ai-raw-details"><summary>${escHtml(label)}</summary><pre class="ai-raw-pre">${escHtml(json)}</pre></details>`;
}

function wireAiHandlers(current, history) {
  const hostInput = document.getElementById("bridgeHost");
  const portInput = document.getElementById("bridgePort");
  const btn = document.getElementById("analyzeBtn");
  const hBtn = document.getElementById("heuristicBtn");
  const status = document.getElementById("aiStatus");
  const bridgeEl = document.getElementById("bridgeStatus");

  readBridgeSettings((s) => {
    if (hostInput) hostInput.value = s.geminiBridgeHost || "127.0.0.1";
    if (portInput) portInput.value = s.geminiBridgePort || "8787";
    pingBridge(
      hostInput?.value || "127.0.0.1",
      portInput?.value || "8787",
      bridgeEl,
    );
  });

  hostInput?.addEventListener("change", () =>
    saveBridgeInputs(hostInput, portInput),
  );
  portInput?.addEventListener("change", () =>
    saveBridgeInputs(hostInput, portInput),
  );

  hBtn?.addEventListener("click", () => {
    const h = computeOfflineHeuristics(current, history);
    if (!h) {
      status.textContent = "No captured videos yet.";
      hideAiResults();
      return;
    }
    status.textContent = "";
    showAiResults(
      renderParsedBlock("Offline estimate", h, { offline: true }) +
        wrapRawDetails("Raw JSON", h),
    );
  });

  btn?.addEventListener("click", () => {
    saveBridgeInputs(hostInput, portInput);
    const host = hostInput?.value?.trim() || "127.0.0.1";
    const port = portInput?.value?.trim() || "8787";

    if (!current && (!history || !history.length)) {
      status.textContent = "No captured videos yet.";
      hideAiResults();
      return;
    }

    const videos = collectVideoSlice(current, history).map(videoToApiPayload);

    status.textContent = "Calling local bridge…";
    hideAiResults();
    btn.disabled = true;

    chrome.runtime.sendMessage(
      { type: "geminiAnalyze", host, port, videos },
      (res) => {
        btn.disabled = false;
        if (chrome.runtime.lastError) {
          status.textContent = chrome.runtime.lastError.message || "Error";
          hideAiResults();
          return;
        }
        if (!res || !res.ok) {
          const detailText = formatBridgeErrorResponse(res);
          const shortStatus = res?.status
            ? `HTTP ${res.status} — `
            : "";
          status.textContent = (shortStatus + detailText).slice(0, 280);

          const fallback = computeOfflineHeuristics(current, history);
          let html = `<div class="ai-error-box"><strong>Bridge request failed</strong>`;
          if (res?.status)
            html += `<span class="ai-http-tag">${escHtml(String(res.status))}</span>`;
          html += `<p class="ai-error-msg">${escHtml(detailText.slice(0, 900))}</p>`;
          if (detailText.includes("GEMINI_COOKIE") || detailText.includes("COOKIES_PATH")) {
            html += `<p class="ai-error-hint">That message is from an <strong>old</strong> server build. Stop uvicorn (Ctrl+C), then start again from the <code>server</code> folder so it loads the latest <code>main.py</code>.</p>`;
          }
          html += `</div>`;

          if (fallback) {
            html += `<p class="ai-fallback-label">Local fallback (same as &quot;Offline heuristics&quot;):</p>`;
            html += renderParsedBlock("Offline estimate", fallback, {
              offline: true,
            });
            html += wrapRawDetails("Raw JSON (error + fallback)", {
              bridge_error: detailText,
              offline_fallback: fallback,
            });
          } else {
            html += wrapRawDetails("Raw error payload", res.data || { error: detailText });
          }
          showAiResults(html);
          return;
        }

        const payload = res.data;
        status.textContent = "";

        if (payload && payload.parsed) {
          showAiResults(
            renderParsedBlock("Analysis", payload.parsed, { offline: false }) +
              wrapRawDetails("Raw JSON (full response)", payload),
          );
        } else if (payload && payload.raw) {
          const note = payload.note
            ? `<p class="ai-card-muted">${escHtml(payload.note)}</p>`
            : "";
          showAiResults(
            `<div class="ai-gemini-card ai-unstructured"><div class="ai-card-head"><span class="ai-card-title">Gemini reply</span></div><p class="ai-raw-snippet">${escHtml(String(payload.raw).slice(0, 3500))}</p>${note}` +
              wrapRawDetails("Raw JSON (full response)", payload),
          );
        } else {
          showAiResults(
            wrapRawDetails("Raw JSON", payload || {}),
          );
        }
      },
    );
  });
}

let breakInterval = null;

function wireFrictionHandlers() {
  const breakBtn = document.getElementById("breakBtn");
  const exploreBtn = document.getElementById("exploreBtn");
  const breakTimer = document.getElementById("breakTimer");

  breakBtn?.addEventListener("click", () => {
    if (breakInterval) {
      clearInterval(breakInterval);
      breakInterval = null;
    }
    let left = 120;
    breakTimer.classList.remove("hidden");
    breakTimer.textContent = `Break: ${left}s — step away from the feed.`;
    breakInterval = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(breakInterval);
        breakInterval = null;
        breakTimer.textContent = "Break done. Welcome back.";
        return;
      }
      breakTimer.textContent = `Break: ${left}s — step away from the feed.`;
    }, 1000);
  });

  const CALM_TOPICS = [
    "woodworking tips",
    "national parks scenery",
    "slow cooking recipes",
    "library architecture",
    "bird watching",
    "pottery throwing",
    "ocean documentary",
    "meditation nature",
  ];

  exploreBtn?.addEventListener("click", () => {
    const q = CALM_TOPICS[Math.floor(Math.random() * CALM_TOPICS.length)];
    const url =
      "https://www.tiktok.com/search?q=" + encodeURIComponent(q);
    chrome.tabs.create({ url });
  });
}

function renderCurrent(data) {
  const { likes, comments, shares, saves } = data.stats || {};
  const { engagement, likeCommentRatio } = data.computed || {};
  const eng = engLabel(likeCommentRatio);
  const dur = fmtDuration(data.duration);
  const hashtags = (data.hashtags || []).slice(0, 12);
  const caption = (data.caption || "").slice(0, 180);

  const fmtBadges = [];
  if (data.format?.isAd) fmtBadges.push('<span class="pill pill-ad">AD</span>');
  if (data.format?.isDuet)
    fmtBadges.push('<span class="pill pill-duet">DUET</span>');
  if (data.format?.isStitch)
    fmtBadges.push('<span class="pill pill-stitch">STITCH</span>');

  const heur = heuristicVideoTags(data);
  const heurHtml = heur.length
    ? `<div class="heur-row">${heur.map((p) => `<span class="pill ${p.cls}">${escHtml(p.label)}</span>`).join("")}</div>`
    : "";

  return `
  <div class="current-card">
    <div class="card-top">
      <div class="live-indicator"><span class="live-dot"></span>LIVE</div>
      ${fmtBadges.join("")}
    </div>

    <div class="author-block">
      <div class="author-name">${escHtml(data.author?.nickname || data.author?.username || "Unknown")}</div>
      ${data.author?.username ? `<div class="author-handle">@${escHtml(data.author.username)}</div>` : ""}
    </div>

    ${heurHtml}

    <div class="stats-row">
      <div class="stat-box">
        <div class="stat-num">${fmt(likes)}</div>
        <div class="stat-lbl">LIKES</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-box">
        <div class="stat-num">${fmt(comments)}</div>
        <div class="stat-lbl">CMTS</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-box">
        <div class="stat-num">${fmt(shares)}</div>
        <div class="stat-lbl">SHARES</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-box">
        <div class="stat-num">${fmt(saves)}</div>
        <div class="stat-lbl">SAVES</div>
      </div>
    </div>

    <div class="signal-row">
      <div class="signal-item">
        <div class="signal-label">TOTAL ENGAGEMENT</div>
        <div class="signal-value accent">${fmt(engagement)}</div>
      </div>
      <div class="signal-item">
        <div class="signal-label">LIKE / COMMENT</div>
        <div class="signal-value ${eng.cls}">${eng.text}</div>
      </div>
    </div>

    ${caption ? `<div class="caption-text">${escHtml(caption)}${(data.caption || "").length > 180 ? "..." : ""}</div>` : ""}

    ${
      hashtags.length
        ? `
    <div class="tags-wrap">
      ${hashtags.map((t) => `<span class="tag">#${escHtml(t)}</span>`).join("")}
    </div>`
        : ""
    }

    <div class="meta-bar">
      ${data.audio ? `<span class="meta-chip">&#9834; ${escHtml(data.audio.slice(0, 32))}</span>` : ""}
      ${dur ? `<span class="meta-chip">${dur}</span>` : ""}
      ${data.postedAt ? `<span class="meta-chip">${escHtml(data.postedAt)}</span>` : ""}
      ${data.commentsData ? `<span class="meta-chip">&#128172; ${data.commentsData.length} intercepted</span>` : `<span class="meta-chip hint-chip">Open comments on a video to capture samples</span>`}
    </div>
  </div>`;
}

function renderHistory(history) {
  if (!history.length) return "";
  const rows = history
    .map((v, i) => {
      const author = v.author?.nickname || v.author?.username || "?";
      const tags = (v.hashtags || [])
        .slice(0, 2)
        .map((t) => "#" + t)
        .join(" ");
      const likes = fmt(v.stats?.likes);
      const time = v.capturedAt
        ? new Date(v.capturedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      return `
    <div class="h-row ${i === 0 ? "h-row-first" : ""}">
      <div class="h-left">
        <div class="h-author">${escHtml(author)}</div>
        <div class="h-tags">${escHtml(tags)}</div>
      </div>
      <div class="h-right">
        <div class="h-likes">${likes}</div>
        <div class="h-time">${v.commentsData ? "&#128172; " + v.commentsData.length + " " : ""}${time}</div>
      </div>
    </div>`;
    })
    .join("");

  return `
  <div class="history-section">
    <div class="section-header">
      <span class="section-title">HISTORY &mdash; ${history.length} videos</span>
      <button class="text-btn" id="clearBtn">clear all</button>
    </div>
    <div class="history-list">${rows}</div>
  </div>`;
}

function toCSV(history) {
  const headers = [
    "capturedAt",
    "url",
    "username",
    "nickname",
    "likes",
    "comments",
    "shares",
    "saves",
    "engagement",
    "likeCommentRatio",
    "duration",
    "audio",
    "hashtags",
    "isDuet",
    "isStitch",
    "isAd",
    "postedAt",
    "caption",
    "commentsData_json",
  ];
  const rows = history.map((v) =>
    [
      v.capturedAt,
      v.url,
      v.author?.username || "",
      v.author?.nickname || "",
      v.stats?.likes ?? "",
      v.stats?.comments ?? "",
      v.stats?.shares ?? "",
      v.stats?.saves ?? "",
      v.computed?.engagement ?? "",
      v.computed?.likeCommentRatio ?? "",
      v.duration ?? "",
      v.audio || "",
      (v.hashtags || []).join(";"),
      v.format?.isDuet ? "1" : "0",
      v.format?.isStitch ? "1" : "0",
      v.format?.isAd ? "1" : "0",
      v.postedAt || "",
      (v.caption || "").replace(/\n/g, " "),
      v.commentsData ? JSON.stringify(v.commentsData) : "[]",
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

function render(current, history) {
  const main = document.getElementById("main");
  const insights = computeSessionInsights(history);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || "";
    const onTikTok = url.includes("tiktok.com");

    if (!onTikTok) {
      main.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">&#128248;</div>
          <div class="empty-title">Not on TikTok</div>
          <div class="empty-sub">Open TikTok and start scrolling</div>
        </div>
        ${renderNutritionSession(insights)}
        ${renderFriction()}
        ${renderAiPanel()}
        ${renderHistory(history)}`;

      wireFrictionHandlers();
      wireAiHandlers(null, history);
    } else if (!current) {
      main.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">&#9654;</div>
          <div class="empty-title">Loading...</div>
          <div class="empty-sub">Analyzing current video</div>
        </div>
        ${renderNutritionSession(insights)}
        ${renderFriction()}
        ${renderAiPanel()}
        ${renderHistory(history)}`;

      wireFrictionHandlers();
      wireAiHandlers(current, history);
    } else {
      main.innerHTML =
        renderCurrent(current) +
        renderNutritionSession(insights) +
        renderFriction() +
        renderAiPanel() +
        renderHistory(history);

      wireFrictionHandlers();
      wireAiHandlers(current, history);
    }

    restoreAiResultsIfAny();

    document.getElementById("clearBtn")?.addEventListener("click", () => {
      lastAiResultsHtml = null;
      chrome.storage.local.set({ current: null, history: [] }, () =>
        render(null, []),
      );
    });
  });
}

chrome.storage.local.get({ current: null, history: [] }, (d) => {
  render(d.current, d.history);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url?.includes("tiktok.com")) return;

    chrome.tabs.sendMessage(tab.id, { type: "captureNow" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        chrome.scripting.executeScript(
          { target: { tabId: tab.id }, files: ["content.js"] },
          () => {
            void chrome.runtime.lastError;
            setTimeout(() => {
              chrome.storage.local.get({ current: null, history: [] }, (d2) =>
                render(d2.current, d2.history),
              );
            }, 1500);
          },
        );
      }
    });
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  chrome.storage.local.get({ current: null, history: [] }, (d) =>
    render(d.current, d.history),
  );
});

document.getElementById("exportBtn").addEventListener("click", () => {
  chrome.storage.local.get({ history: [] }, (d) => {
    if (!d.history.length) return;
    const blob = new Blob([toCSV(d.history)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tiktok-" + Date.now() + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  });
});
