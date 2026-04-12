"""Unofficial Gemini web UI client — same request shape as repo root gemini.py."""
from __future__ import annotations

import json
import urllib.parse
from typing import Any

import requests

STREAM_URL = (
    "https://gemini.google.com/_/BardChatUi/data/"
    "assistant.lamda.BardFrontendService/StreamGenerate"
)

# Match gemini.py exactly: no cookie string (not required for the script flow you use).
HEADERS = {
    "accept": "*/*",
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "x-same-domain": "1",
    "cookie": "",
}


def build_payload(prompt: str) -> str:
    inner: list[Any] = [
        [prompt, 0, None, None, None, None, 0],
        ["en-US"],
        ["", "", "", None, None, None, None, None, None, ""],
        "",
        "",
        None,
        [0],
        1,
        None,
        None,
        1,
        0,
        None,
        None,
        None,
        None,
        None,
        [[0]],
        0,
    ]
    outer = [None, json.dumps(inner)]
    return urllib.parse.urlencode({"f.req": json.dumps(outer)}) + "&"


def parse_stream_response(text: str) -> str:
    text = text.replace(")]}'", "")
    best = ""

    for line in text.splitlines():
        if "wrb.fr" not in line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue

        entries: list[list[Any]] = []
        if isinstance(data, list):
            if data and data[0] == "wrb.fr":
                entries = [data]
            else:
                entries = [
                    i for i in data
                    if isinstance(i, list) and i and i[0] == "wrb.fr"
                ]

        for entry in entries:
            try:
                inner = json.loads(entry[2])
                if (
                    isinstance(inner, list)
                    and len(inner) > 4
                    and isinstance(inner[4], list)
                ):
                    for c in inner[4]:
                        if isinstance(c, list) and len(c) > 1 and isinstance(c[1], list):
                            txt = "".join(
                                t for t in c[1] if isinstance(t, str)
                            )
                            if len(txt) > len(best):
                                best = txt
            except (json.JSONDecodeError, TypeError, IndexError, KeyError):
                continue

    return best.strip()


def ask_gemini(prompt: str) -> tuple[int, str]:
    """POST to StreamGenerate using the same headers as gemini.py (empty Cookie)."""
    payload = build_payload(prompt)
    try:
        res = requests.post(
            STREAM_URL,
            headers=HEADERS,
            data=payload,
            timeout=120,
        )
    except requests.RequestException as e:
        return 0, f"[network error] {e}"

    if res.status_code != 200:
        return res.status_code, f"[HTTP {res.status_code}] {res.text[:500]}"

    parsed = parse_stream_response(res.text) or "[No response]"
    return res.status_code, parsed
