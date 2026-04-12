"""
Local bridge: /health and /analyze for the Chrome extension.
Uses the same empty Cookie header as repo gemini.py (see gemini_client.HEADERS).
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from gemini_client import ask_gemini

app = FastAPI(title="TikTok Analyzer Gemini Bridge", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class VideoSlice(BaseModel):
    model_config = ConfigDict(extra="ignore")

    video_id: str | None = None
    author: str | None = None
    caption: str | None = None
    hashtags: list[str] = Field(default_factory=list)
    stats: dict[str, Any] = Field(default_factory=dict)
    is_ad: bool = False
    comments_summary: str | None = None
    purchase_intent_comments: int = 0
    comment_languages: list[str] = Field(default_factory=list)


class AnalyzeRequest(BaseModel):
    videos: list[VideoSlice] = Field(default_factory=list)
    """Raw bundle from extension; server turns it into one prompt."""


ANALYSIS_INSTRUCTIONS = """You are helping a user reflect on patterns in short-form video feeds.
You NEVER claim to know TikTok's internal ranking model. Outputs are hypotheses from surface signals only.
Reply with ONLY valid JSON (no markdown fence) using exactly these keys:
{
  "topics": string[] (max 5),
  "arousal_level": "low" | "medium" | "high",
  "clustering_note": string (one short sentence about repeated themes),
  "transparency_disclaimer": string (one sentence: we only see surface/metadata),
  "suggested_action": string (one practical tip),
  "low_value_likelihood": "low" | "medium" | "high",
  "mature_or_sensitive_themes": "low" | "medium" | "high",
  "scam_or_deceptive_signals": "low" | "medium" | "high",
  "purchase_or_sales_pressure": "low" | "medium" | "high"
}
Frame low_value, mature themes, scam, and purchase pressure as cautious guesses, not accusations."""


def build_user_prompt(videos: list[VideoSlice]) -> str:
    lines: list[str] = []
    for i, v in enumerate(videos[:20], start=1):
        lines.append(f"--- Video {i} ---")
        if v.author:
            lines.append(f"author: {v.author}")
        if v.caption:
            lines.append(f"caption: {v.caption[:500]}")
        if v.hashtags:
            lines.append("hashtags: " + ", ".join(v.hashtags[:25]))
        if v.stats:
            lines.append(f"stats: {json.dumps(v.stats, ensure_ascii=False)[:400]}")
        lines.append(f"ad: {'yes' if v.is_ad else 'no'}")
        if v.comments_summary:
            lines.append(f"comments (sample): {v.comments_summary[:1200]}")
        if v.purchase_intent_comments:
            lines.append(
                f"comments flagged purchase-intent count: {v.purchase_intent_comments}"
            )
        if v.comment_languages:
            lines.append("comment languages: " + ", ".join(v.comment_languages[:15]))
    return "\n".join(lines)


def try_parse_json_object(text: str) -> dict[str, Any] | None:
    text = text.strip()
    m = re.search(r"\{[\s\S]*\}\s*$", text)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "gemini_mode": "gemini_py_empty_cookie"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict[str, Any]:
    if not req.videos:
        raise HTTPException(status_code=400, detail="No videos in request")

    user_blob = build_user_prompt(req.videos)
    prompt = ANALYSIS_INSTRUCTIONS + "\n\n--- FEED DATA (newest first) ---\n" + user_blob

    status, raw = ask_gemini(prompt)
    if status != 200:
        raise HTTPException(status_code=502, detail=raw[:2000])

    parsed = try_parse_json_object(raw)
    if parsed is not None:
        return {"ok": True, "raw": raw, "parsed": parsed}

    return {"ok": True, "raw": raw, "parsed": None, "note": "Model did not return strict JSON"}


def main() -> None:
    import uvicorn

    host = os.environ.get("BRIDGE_HOST", "127.0.0.1")
    port = int(os.environ.get("BRIDGE_PORT", "8787"))
    uvicorn.run("main:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
