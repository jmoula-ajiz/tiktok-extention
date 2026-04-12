import requests
import json
import urllib.parse

URL = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"

HEADERS = {
    "accept": "*/*",
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "x-same-domain": "1",
    "cookie": ""  # waywaaa
}


def build_payload(prompt):
    inner = [
        [prompt, 0, None, None, None, None, 0],
        ["en-US"],
        ["", "", "", None, None, None, None, None, None, ""],
        "", "", None, [0], 1, None, None, 1, 0,
        None, None, None, None, None, [[0]], 0
    ]

    outer = [None, json.dumps(inner)]

    return urllib.parse.urlencode({
        "f.req": json.dumps(outer)
    }) + "&"


def parse_response(text):
    text = text.replace(")]}'", "")
    best = ""

    for line in text.splitlines():
        if "wrb.fr" not in line:
            continue

        try:
            data = json.loads(line)
        except:
            continue

        entries = []
        if isinstance(data, list):
            if data[0] == "wrb.fr":
                entries = [data]
            else:
                entries = [i for i in data if isinstance(i, list) and i[0] == "wrb.fr"]

        for entry in entries:
            try:
                inner = json.loads(entry[2])

                if isinstance(inner, list) and isinstance(inner[4], list):
                    for c in inner[4]:
                        if isinstance(c, list) and isinstance(c[1], list):
                            txt = "".join([t for t in c[1] if isinstance(t, str)])
                            if len(txt) > len(best):
                                best = txt
            except:
                continue

    return best.strip()


def ask(prompt):
    payload = build_payload(prompt)

    res = requests.post(URL, headers=HEADERS, data=payload)

    if res.status_code != 200:
        return f"[ERROR {res.status_code}]"

    return parse_response(res.text) or "[No response]"


# ===== CHAT LOOP =====
print("⚠️ Unofficial Gemini Chatbot (type 'exit' to quit)\n")

while True:
    user_input = input("You: ")

    if user_input.lower() in ["exit", "quit"]:
        break

    reply = ask(user_input)
    print("Bot:", reply)

