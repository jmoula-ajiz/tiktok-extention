# Gemini bridge (local)

Unofficial Gemini web endpoint (same idea as repo root `gemini.py`). **No API key.** The bridge sends the same **empty `Cookie` header** as `gemini.py` — no `GEMINI_COOKIE`, no cookie file, no extra setup.

## Setup

```bash
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```powershell
cd server
python -m uvicorn main:app --host 127.0.0.1 --port 8787
```

Health check: `http://127.0.0.1:8787/health` — returns `{"ok": true, "gemini_mode": "gemini_py_empty_cookie"}`.

The Chrome extension calls `POST http://127.0.0.1:8787/analyze` with JSON `{ "videos": [...] }`.

If you still see errors about `GEMINI_COOKIE` or `COOKIES_PATH`, you are hitting an **old** server process — stop uvicorn (Ctrl+C) and start it again from the `server` folder so it loads the current `main.py`.
