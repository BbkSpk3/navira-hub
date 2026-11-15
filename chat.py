# =====================================================================
#  chat.py - the AI assistant
#  Website chat widget + Facebook Messenger + Instagram messages,
#  with table booking through the Navira booking API.
# =====================================================================

import functools
import hashlib
import hmac
import json
import os
import re
import threading
import time
import traceback
from collections import defaultdict, deque
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import anthropic
import requests
from flask import Blueprint, Response, abort, jsonify, request, send_from_directory

import core

print = functools.partial(print, flush=True)

NAVIRA_API = "https://api.reserve.naviratechnology.com"
MODEL = os.environ.get("CHAT_MODEL", "claude-sonnet-5-5")
UK = ZoneInfo("Europe/London")
CHANNELS = ["website", "facebook", "instagram", "whatsapp"]

client = anthropic.Anthropic(max_retries=3)
bp = Blueprint("chat", __name__)


# =====================================================================
#  1. NAVIRA BOOKING API
# =====================================================================
class BookingError(Exception):
    pass


def navira(paths, method="GET", body=None):
    last = "Could not reach the booking system"
    for path in paths:
        url = f"{NAVIRA_API}/{path}"
        try:
            r = requests.request(method, url, json=body, timeout=15, headers={
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NaviraChat/1.0",
            })
        except requests.RequestException as e:
            print(f"[API] {method} {url} -> cannot connect: {e}")
            continue
        print(f"[API] {method} {url} -> {r.status_code} {r.text[:300]}")
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.ok and isinstance(data, dict) and data.get("success") is not False:
            return data
        msg = data.get("message") if isinstance(data, dict) else None
        if not msg and isinstance(data, dict) and isinstance(data.get("errors"), list):
            msg = " ".join(str(e.get("message") or e.get("msg") or e) if isinstance(e, dict) else str(e)
                           for e in data["errors"])
        last = msg or f"Booking system error ({r.status_code})"
        if r.status_code != 404:
            raise BookingError(last)
    raise BookingError(last)


def fetch_times(slug, day, party):
    data = navira([
        f"api/v1/reservation/{slug}/available-times?date={day}&partySize={party}",
        f"api/v1/reservations/restaurants/{slug}/online/available-times?date={day}&party={party}",
    ])
    raw = data.get("data") or []
    return [str(t["time"]) if isinstance(t, dict) and t.get("time") else str(t) for t in raw if t]


def hhmm(t):
    return str(t)[:5]


def pretty_time(t):
    h, m = map(int, hhmm(t).split(":"))
    return f"{h % 12 or 12}:{m:02d}{'pm' if h >= 12 else 'am'}"


def uk_phone(v):
    d = re.sub(r"\D", "", str(v or ""))
    if d.startswith("44"):
        d = "0" + d[2:]
    if d.startswith("00"):
        d = d[1:]
    return d[:11]


def check_date(day, days_ahead):
    try:
        d = date.fromisoformat(day)
    except ValueError:
        return "Date must be in YYYY-MM-DD format."
    today = datetime.now(UK).date()
    if d < today:
        return "That date is in the past."
    if d > today + timedelta(days=days_ahead):
        return f"Online bookings are only open up to {days_ahead} days ahead. Please call the restaurant."
    return None


# =====================================================================
#  2. TOOLS (what the AI is allowed to DO)
# =====================================================================
def tool_check_available_times(cfg, date, party_size, **_):
    err = check_date(date, cfg["days_ahead"])
    if err:
        return {"ok": False, "error": err}
    if not 1 <= int(party_size) <= cfg["max_party"]:
        return {"ok": False, "error": f"Online bookings are for 1 to {cfg['max_party']} guests. "
                                      f"Larger groups please call {cfg['phone']}."}
    try:
        times = fetch_times(cfg["navira_slug"], date, party_size)
    except BookingError as e:
        return {"ok": False, "error": str(e)}
    if not times:
        return {"ok": True, "date": date, "party_size": party_size, "available_times": [],
                "message": "No free tables for that day and group size."}
    return {"ok": True, "date": date, "party_size": party_size, "available_times": times}


def tool_make_booking(cfg, full_name, email, phone, date, time, party_size, note="", _channel="website", **_):
    problems = []
    name = re.sub(r"\s+", " ", str(full_name)).strip()
    if not name or not re.fullmatch(r"[A-Za-z ]+", name):
        problems.append("Full name can only contain letters and spaces.")
    elif len(name) > 50:
        problems.append("Name cannot be longer than 50 characters.")
    email = str(email).strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        problems.append("Email address is not valid.")
    phone = uk_phone(phone)
    if not re.fullmatch(r"0\d{9,10}", phone):
        problems.append("Phone must be a UK number, digits only, e.g. 07700900000.")
    note = (note or "").strip()
    if len(note) > 200:
        problems.append("Special requests must be 200 characters or less.")
    err = check_date(date, cfg["days_ahead"])
    if err:
        problems.append(err)
    if problems:
        return {"ok": False, "booked": False, "error": " ".join(problems)}

    slug = cfg["navira_slug"]
    try:
        times = fetch_times(slug, date, party_size)
    except BookingError as e:
        return {"ok": False, "booked": False, "error": str(e)}
    match = next((t for t in times if hhmm(t) == hhmm(time)), None)
    if not match:
        return {"ok": False, "booked": False,
                "error": f"{hhmm(time)} is no longer free on {date} for {party_size}.",
                "available_times": times}

    payload = {
        "customer": {"fullName": name, "email": email, "phone": phone},
        "reservation": {"partySize": int(party_size), "date": date, "startTime": match, "note": note or None},
        "partySize": int(party_size), "date": date, "startTime": match, "note": note or None,
    }
    try:
        data = navira([
            f"api/v1/reservation/{slug}/new-reservation",
            f"api/v1/reservations/restaurants/{slug}/online",
        ], method="POST", body=payload)
    except BookingError as e:
        return {"ok": False, "booked": False, "error": str(e)}
    d = data.get("data")
    if not d:
        return {"ok": False, "booked": False, "error": data.get("message") or "Booking failed"}
    ref = (d.get("refCode") or d.get("referenceCode") or "") if isinstance(d, dict) else ""
    print(f"[BOOKED] {cfg['id']} | {name} | {date} {hhmm(match)} | {party_size} people | ref {ref} | via {_channel}")
    try:
        core.log_booking(cfg["id"], {"name": name, "date": date, "time": hhmm(match), "party": int(party_size),
                                     "ref": ref, "via": _channel})
    except OSError as e:
        print("[BOOKING LOG]", e)
    return {"ok": True, "booked": True, "reference": ref or "(none returned)",
            "date": date, "time": hhmm(match), "party_size": party_size, "name": name, "email": email}


BOOKING_TOOLS = [
    {
        "name": "check_available_times",
        "description": "Get free table times for a date and number of guests from the live booking diary. "
                       "Always call this before offering times.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "party_size": {"type": "integer"},
            },
            "required": ["date", "party_size"],
        },
    },
    {
        "name": "make_booking",
        "description": "Book a table in the live booking diary. Only call after the time was shown as free, "
                       "you have full name, email and UK phone, and the customer said YES to the summary.",
        "input_schema": {
            "type": "object",
            "properties": {
                "full_name": {"type": "string", "description": "Letters and spaces only"},
                "email": {"type": "string"},
                "phone": {"type": "string", "description": "UK number, e.g. 07700900000"},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "time": {"type": "string", "description": "HH:MM, one of the available times"},
                "party_size": {"type": "integer"},
                "note": {"type": "string", "description": "Optional special requests, max 200 characters"},
            },
            "required": ["full_name", "email", "phone", "date", "time", "party_size"],
        },
    },
]
TOOL_FUNCS = {"check_available_times": tool_check_available_times, "make_booking": tool_make_booking}


# =====================================================================
#  3. THE AI ASSISTANT
# =====================================================================
def rules(cfg):
    text = f"""You are the friendly online assistant for {cfg['name']}.
Address: {cfg['address'] or 'see information below'}. Phone: {cfg['phone'] or 'see information below'}.

ANSWERING QUESTIONS
- Answer ONLY from the restaurant information below. If it's not there, say you're not sure and give the phone number.
- For allergies, always add: "Please tell our staff about any allergy when you arrive."
- Only talk about this restaurant. Politely decline unrelated requests.
"""
    if cfg["order_url"]:
        text += f"- For food orders (collection/delivery), give this link: {cfg['order_url']}\n"
    if cfg["navira_slug"]:
        text += f"""
BOOKING A TABLE - follow these steps in order
1. Get the day, number of guests and preferred time (ask only for what's missing).
2. Call check_available_times. Offer the free times closest to what they asked for. Never invent times.
   If nothing is free, suggest another day or calling.
3. Ask for full name, email and phone number (UK, e.g. 07700900000).
4. Show a short summary (day, date, time, guests, name, email, phone, any special request) and ask "Shall I book this?"
5. Only after they say yes, call make_booking.
6. Only say the table is booked if make_booking returns booked: true. Then give the reference
   and say a confirmation email is on its way. If it fails, explain simply and offer another time or the phone number.
- Online bookings: 1 to {cfg['max_party']} guests, up to {cfg['days_ahead']} days ahead. Bigger groups: call.
"""
    else:
        text += f"\nTABLE BOOKINGS: online booking isn't available in this chat. Ask customers to call {cfg['phone']}.\n"
    text += """
STYLE
- Short, warm, simple replies (1-4 sentences). Use **bold** for key details like times and references.
- Use 12-hour times like 7:30pm. No headings or tables.
"""
    return text


CHANNEL_NOTES = {
    "website": "",
    "facebook": " This chat is on Facebook Messenger: write plain text only, no ** or other markdown.",
    "instagram": " This chat is on Instagram messages: write plain text only, no ** or other markdown, and keep replies short.",
    "whatsapp": " This chat is on WhatsApp: write plain text only, no ** or other markdown, and keep replies short. "
                "You already have the customer's WhatsApp number, but still ask which phone number to put on a booking.",
}


def system_prompt(cfg, channel="website"):
    now = datetime.now(UK)
    week = ", ".join(f"{(now + timedelta(days=i)):%A}={(now + timedelta(days=i)):%Y-%m-%d}" for i in range(8))
    return [
        {"type": "text",
         "text": rules(cfg) + "\n\n=== RESTAURANT INFORMATION ===\n" + cfg["knowledge"],
         "cache_control": {"type": "ephemeral"}},
        {"type": "text",
         "text": f"Right now it is {now:%A %d %B %Y, %H:%M} (UK). Next days: {week}. "
                 f"Turn 'tomorrow', 'Friday' etc. into YYYY-MM-DD." + CHANNEL_NOTES.get(channel, "")},
    ]


def ask_ai(cfg, messages, channel="website"):
    for attempt in range(4):
        try:
            return client.messages.create(
                model=MODEL,
                max_tokens=1200,
                system=system_prompt(cfg, channel),
                tools=BOOKING_TOOLS if cfg["navira_slug"] else [],
                messages=messages,
            )
        except (anthropic.RateLimitError, anthropic.InternalServerError, anthropic.APIConnectionError) as e:
            wait = 5 * (attempt + 1)
            print(f"[AI BUSY] {type(e).__name__}: {e} -> waiting {wait}s")
            time.sleep(wait)
    raise RuntimeError("AI still busy after 4 tries")


conversations = {}          # chats kept in memory: key = (restaurant id, chat id)
last_used = {}
lock = threading.Lock()
chat_locks = defaultdict(threading.Lock)


def cleanup():
    cutoff = time.time() - 3 * 3600          # forget chats idle for 3 hours
    with lock:
        for k in [k for k, t in last_used.items() if t < cutoff]:
            conversations.pop(k, None)
            last_used.pop(k, None)
            chat_locks.pop(k, None)


def run_agent(cfg, messages, user_message, channel="website"):
    messages.append({"role": "user", "content": user_message})
    chips = []
    for _ in range(8):
        response = ask_ai(cfg, messages, channel)
        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason != "tool_use":
            return "".join(b.text for b in response.content if b.type == "text").strip(), chips
        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            func = TOOL_FUNCS.get(block.name)
            try:
                out = func(cfg, **{**block.input, "_channel": channel}) if func else {"ok": False, "error": "Unknown tool"}
            except Exception as e:
                print("[TOOL ERROR]", block.name, e)
                out = {"ok": False, "error": "Something went wrong with the booking system."}
            print(f"[TOOL] {cfg['id']} {block.name} {json.dumps(block.input)} -> {json.dumps(out)[:300]}")
            times = out.get("available_times") if isinstance(out, dict) else None
            chips = [{"label": pretty_time(t), "send": pretty_time(t)} for t in (times or [])[:12]]
            if isinstance(out, dict) and out.get("booked"):
                chips = []
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(out)})
        messages.append({"role": "user", "content": results})
    return f"Sorry, I got a bit stuck. Please call us on {cfg['phone']}.", []


def answer(cfg, key, text, channel):
    """Run one customer message through the AI, safely. Every message is also kept in Messages (the inbox).
    Returns (None, []) when a member of staff has taken the conversation over."""
    who = key[1].split(":", 1)[1]
    cleanup()
    with chat_locks[key]:                                   # one message at a time per customer
        try:
            conv = core.inbox_add(cfg["id"], channel, who, "customer", text)
        except (OSError, ValueError) as e:
            print("[INBOX]", e)
            conv = {}
        if conv.get("paused"):
            return None, []
        core.count(cfg["id"], "chats")
        limit = cfg.get("monthly_limit") or 0
        if limit and core.ai_used(cfg["id"]) >= limit:      # this month's AI allowance is used up
            print(f"[LIMIT] {cfg['id']}: monthly AI limit of {limit} reached, AI not used")
            reply = ("Sorry, our chat assistant is not available right now. "
                     + (f"Please call us on {cfg['phone']}." if cfg["phone"] else "Please contact the restaurant directly."))
            try:
                core.inbox_add(cfg["id"], channel, who, "ai", reply)
            except (OSError, ValueError) as e:
                print("[INBOX]", e)
            return reply, []
        core.count(cfg["id"], "ai")
        with lock:
            history = conversations.setdefault(key, [])
            last_used[key] = time.time()
        before = len(history)
        try:
            reply, chips = run_agent(cfg, history, text, channel)
        except Exception as e:
            print("[ERROR]", cfg["id"], channel, type(e).__name__, e)
            traceback.print_exc()
            del history[before:]
            reply, chips = f"Sorry, I couldn't finish that. Please send your message again, or call {cfg['phone']}.", []
        reply = reply or "Sorry, could you say that again?"
        try:
            core.inbox_add(cfg["id"], channel, who, "ai", reply)
        except (OSError, ValueError) as e:
            print("[INBOX]", e)
    return reply, chips


def staff_reply(rid, channel, who, text):
    """A member of staff answers from Messages. Sent to Facebook/Instagram straight away;
    on the website the chat window picks it up within a few seconds."""
    text = str(text or "").strip()[:1800]
    if not text:
        raise ValueError("Type a reply first.")
    if channel in ("facebook", "instagram"):
        if not page_token(rid):
            raise ValueError(f"This restaurant's Page token is missing ({token_name(rid)}).")
        body = {"recipient": {"id": who}, "messaging_type": "RESPONSE", "message": {"text": text}}
        if not meta_post(rid, body):
            raise ValueError("Meta did not accept the message. Meta only allows replies within 24 hours of the "
                             "customer's last message. See the server logs for the exact reason.")
    elif channel == "whatsapp":
        cfg = core.chat_cfg(rid)
        if not whatsapp_token(rid) or not cfg["whatsapp_phone_id"]:
            raise ValueError(f"WhatsApp is not set up for this restaurant (phone number ID, and {whatsapp_token_name(rid)} or WHATSAPP_TOKEN).")
        if not whatsapp_send(rid, cfg["whatsapp_phone_id"], who, text):
            raise ValueError("WhatsApp did not accept the message. Free replies are only allowed within 24 hours of the "
                             "customer's last message. See the server logs for the exact reason.")
    core.inbox_add(rid, channel, who, "staff", text)
    with lock:                                              # so the AI knows what staff said, if it is handed back
        history = conversations.get((rid, f"{channel}:{who}"))
        if history is not None and history and history[-1]["role"] == "assistant" and isinstance(history[-1]["content"], str):
            history[-1]["content"] += "\n" + text
        elif history is not None and history and history[-1]["role"] == "user":
            history.append({"role": "assistant", "content": text})


# =====================================================================
#  4. SIMPLE PROTECTION
# =====================================================================
hits = defaultdict(deque)


def too_many_messages(who, limit=30, seconds=600):
    """Max 30 messages per 10 minutes from one person (stops abuse / big AI bills)."""
    now = time.time()
    q = hits[who]
    while q and q[0] < now - seconds:
        q.popleft()
    q.append(now)
    return len(q) > limit


def origin_allowed(cfg, origin):
    allowed = [str(w).rstrip("/").lower() for w in cfg["allowed_websites"] if w]
    if not allowed or not origin:
        return True                    # empty list = allow everywhere
    origin = origin.rstrip("/").lower()
    return origin in allowed or origin == request.host_url.rstrip("/").lower()


def get_cfg(rid):
    cfg = core.chat_cfg(str(rid or ""))
    if not cfg:
        abort(404, "Unknown restaurant")
    return cfg


# =====================================================================
#  5. WEBSITE CHAT
# =====================================================================
@bp.after_request
def cors(resp):
    origin = request.headers.get("Origin")
    if origin and (request.path.startswith("/api/") or request.path == "/widget.js"):
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@bp.route("/widget.js")
def widget_js():
    resp = send_from_directory(os.path.join(core.HERE, "static"), "widget.js")
    resp.headers["Cache-Control"] = "public, max-age=300"
    return resp


@bp.route("/api/config/<rid>")
def widget_config(rid):
    cfg = get_cfg(rid)
    return jsonify({
        "name": cfg["name"],
        "assistant_name": cfg["assistant_name"] or f"{cfg['name']} assistant",
        "greeting": cfg["greeting"] or f"Hi! 👋 I'm the {cfg['name']} assistant. "
                                       + ("I can book you a table or answer questions." if cfg["navira_slug"]
                                          else "Ask me anything about us."),
        "quick_replies": cfg["quick_replies"],
        "phone": cfg["phone"],
        "theme": {**cfg["theme"], "on": core.on_colour(cfg["theme"]["color"])},
        "booking": bool(cfg["navira_slug"]),
        "mobile_bottom_offset": 18,
        "enabled": bool(cfg["ai"].get("website")) and not core.is_offline(cfg["id"]),
    })


@bp.route("/api/chat", methods=["POST", "OPTIONS"])
def chat():
    if request.method == "OPTIONS":
        return "", 204
    data = request.get_json(silent=True) or {}
    cfg = get_cfg(data.get("restaurant"))
    if not origin_allowed(cfg, request.headers.get("Origin")):
        print(f"[BLOCKED] {cfg['id']} chat from {request.headers.get('Origin')}")
        return jsonify({"reply": "This chat isn't set up for this website."}), 403
    if not cfg["ai"].get("website"):
        return jsonify({"reply": f"Our chat assistant is switched off right now. Please call us on {cfg['phone']}.",
                        "chips": [], "off": True})
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    if too_many_messages(ip):
        return jsonify({"reply": f"You're sending messages very fast. Please wait a few minutes or call {cfg['phone']}."})
    message = str(data.get("message") or "").strip()[:500]
    if not message:
        return jsonify({"reply": "Please type a message."})
    chat_id = re.sub(r"[^A-Za-z0-9_-]", "", str(data.get("chat_id") or ""))[:64] or re.sub(r"[^0-9a-f]", "", ip)[:32] or "visitor"
    reply, chips = answer(cfg, (cfg["id"], "website:" + chat_id), message, "website")
    if reply is None:                                       # staff have taken this chat over
        return jsonify({"reply": "", "chips": [], "waiting": True, "now": int(time.time())})
    return jsonify({"reply": reply, "chips": chips, "now": int(time.time())})


@bp.route("/api/chat/updates")
def chat_updates():
    """The website chat window asks every few seconds: has a member of staff written anything new?"""
    cfg = get_cfg(request.args.get("restaurant"))
    chat_id = re.sub(r"[^A-Za-z0-9_-]", "", request.args.get("chat_id", ""))[:64]
    try:
        after = int(request.args.get("after", "0"))
    except ValueError:
        after = 0
    if not chat_id:
        return jsonify({"messages": [], "now": int(time.time())})
    conv = core.inbox_get(cfg["id"], "website", chat_id)
    new = [{"text": m["text"], "at": m["at"]} for m in conv["messages"] if m["role"] == "staff" and m["at"] > after]
    return jsonify({"messages": new, "now": int(time.time()), "paused": bool(conv.get("paused"))})


# =====================================================================
#  5b. TABLE BOOKING FORM ON THE WEBSITE
#      The website's own "Book a table" form talks to these addresses, and
#      they talk to the Navira booking API. Nothing is stored here except a
#      short line in the bookings list (name, date, time, guests, reference).
# =====================================================================
_info_cache = {}


def booking_cfg(rid):
    cfg = get_cfg(rid)
    if not cfg["navira_slug"]:
        abort(404, "Online booking is not set up for this restaurant")
    return cfg


def client_ip():
    return request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()


@bp.route("/api/booking/<rid>/info")
def booking_info(rid):
    cfg = booking_cfg(rid)
    cached = _info_cache.get(rid)
    if cached and cached[0] > time.time() - 300:
        return jsonify(cached[1])
    out = {"ok": True, "max_party": cfg["max_party"], "paused": False}
    try:
        data = navira([f"api/v1/reservation/{cfg['navira_slug']}/reservation-info",
                       f"api/v1/restaurants/{cfg['navira_slug']}/details"]).get("data") or {}
        if data.get("isTakingReservation") is False or data.get("isTakingbooking") is False:
            out["paused"] = True
        if str(data.get("maxPartySize") or "").isdigit():
            out["max_party"] = min(cfg["max_party"], int(data["maxPartySize"]))
    except BookingError:
        pass                                                # the times check will show any real problem
    _info_cache[rid] = (time.time(), out)
    return jsonify(out)


@bp.route("/api/booking/<rid>/times")
def booking_times(rid):
    cfg = booking_cfg(rid)
    if too_many_messages("times:" + client_ip(), limit=90):
        return jsonify({"ok": False, "error": "Too many checks. Please wait a minute."}), 429
    try:
        party = int(request.args.get("party", "2"))
    except ValueError:
        party = 2
    out = tool_check_available_times(cfg, request.args.get("date", ""), party)
    if not out.get("ok"):
        return jsonify({"ok": False, "error": out.get("error", "Could not check tables.")})
    return jsonify({"ok": True, "times": out.get("available_times", [])})


@bp.route("/api/booking/<rid>/book", methods=["POST"])
def booking_book(rid):
    cfg = booking_cfg(rid)
    origin = request.headers.get("Origin")
    if origin and origin.split("://", 1)[-1].rstrip("/").lower() != request.host.lower():
        return jsonify({"ok": False, "error": "Bookings can only be made from the restaurant's website."}), 403
    if too_many_messages("book:" + client_ip(), limit=8):
        return jsonify({"ok": False, "error": f"Too many tries. Please call {cfg['phone']}."}), 429
    d = request.get_json(silent=True) or {}
    try:
        party = int(d.get("party_size") or 0)
    except (TypeError, ValueError):
        party = 0
    if not 1 <= party <= cfg["max_party"]:
        return jsonify({"ok": False, "error": f"Online bookings are for 1 to {cfg['max_party']} guests. Please call {cfg['phone']}."})
    out = tool_make_booking(cfg, str(d.get("full_name") or ""), str(d.get("email") or ""), str(d.get("phone") or ""),
                            str(d.get("date") or ""), str(d.get("time") or ""), party, str(d.get("note") or ""),
                            _channel="website form")
    if not out.get("booked"):
        return jsonify({"ok": False, "error": out.get("error", "The booking did not go through."), "times": out.get("available_times")})
    return jsonify({"ok": True, "booking": {k: out[k] for k in ("reference", "date", "time", "party_size", "email")}})


# =====================================================================
#  6. FACEBOOK MESSENGER + INSTAGRAM MESSAGES
#     Secrets go in the server's Environment Variables, never in the code:
#        META_VERIFY_TOKEN      any password you make up (typed into Meta too)
#        META_APP_SECRET        from your Meta app -> App settings -> Basic
#        PAGE_TOKEN_<ID>        the restaurant's Page access token,
#                               e.g. PAGE_TOKEN_NAMASTE for the restaurant "namaste"
# =====================================================================
META_VERIFY_TOKEN = os.environ.get("META_VERIFY_TOKEN", "")
META_APP_SECRET = os.environ.get("META_APP_SECRET", "")
_ver = os.environ.get("META_GRAPH_VERSION", "").strip("/")
GRAPH_URL = "https://graph.facebook.com" + (f"/{_ver}" if _ver else "")
TEXT_LIMIT = {"facebook": 1900, "instagram": 950}     # bytes per message (Meta's limits are 2000 / 1000)
seen_messages = deque(maxlen=5000)      # Meta sometimes sends the same message twice


def token_name(rid):
    return "PAGE_TOKEN_" + re.sub(r"[^A-Z0-9]", "_", rid.upper())


def page_token(rid):
    return os.environ.get(token_name(rid), "")


def restaurant_for(channel, account_id):
    field = {"facebook": "facebook_page_id", "whatsapp": "whatsapp_phone_id"}.get(channel, "instagram_id")
    for rid in core.ids():
        try:
            if str(core.load(rid)["chat"][field] or "").strip() == str(account_id):
                return rid
        except (OSError, ValueError):
            continue
    return None


def split_text(text, limit):
    """Cut a long reply into pieces that fit in one message (counted in bytes)."""
    parts, current = [], ""
    for word in re.split(r"(\s+)", text):
        if len((current + word).encode("utf-8")) > limit and current.strip():
            parts.append(current.strip())
            current = ""
        while len(word.encode("utf-8")) > limit:
            parts.append(word[:limit // 4])
            word = word[limit // 4:]
        current += word
    if current.strip():
        parts.append(current.strip())
    return parts


def meta_post(rid, body):
    r = requests.post(f"{GRAPH_URL}/me/messages", json=body, timeout=15,
                      headers={"Authorization": "Bearer " + page_token(rid)})
    if not r.ok:
        print(f"[META] send failed for {rid}: {r.status_code} {r.text[:300]}")
    return r.ok


def meta_send(rid, channel, user_id, text, chips=None):
    parts = split_text(text.replace("**", ""), TEXT_LIMIT[channel]) or ["Sorry, could you say that again?"]
    for i, part in enumerate(parts):
        body = {"recipient": {"id": user_id}, "messaging_type": "RESPONSE", "message": {"text": part}}
        if i == len(parts) - 1 and chips:                   # free times as buttons to tap
            body["message"]["quick_replies"] = [
                {"content_type": "text", "title": c["label"][:20], "payload": c["send"][:100]} for c in chips[:12]]
        if not meta_post(rid, body) and "quick_replies" in body["message"]:
            del body["message"]["quick_replies"]            # try once more as plain text
            meta_post(rid, body)


def handle_meta_message(channel, account_id, event):
    try:
        msg = event.get("message") or {}
        sender = str((event.get("sender") or {}).get("id") or "")
        text = str(msg.get("text") or "").strip()[:1000]
        if not sender or not text or msg.get("is_echo"):
            return                                          # photos, likes, our own messages: ignore
        mid = msg.get("mid")
        with lock:
            if mid and mid in seen_messages:
                return
            seen_messages.append(mid)
        account_id = str((event.get("recipient") or {}).get("id") or account_id or "")
        rid = restaurant_for(channel, account_id)
        if not rid:
            label = "Facebook Page ID" if channel == "facebook" else "Instagram account ID"
            print(f"[META] {channel} message for an account that is not set up. "
                  f"In the admin, open the restaurant -> Chat & channels and set {label} to {account_id}")
            return
        cfg = core.chat_cfg(rid)
        if sender == account_id:
            return
        if not cfg["ai"].get(channel):
            print(f"[META] {rid} {channel}: AI is OFF, message left for staff")
            return
        if not page_token(rid):
            print(f"[META] {rid}: add {token_name(rid)} in the Environment Variables")
            return
        if too_many_messages(f"{channel}:{sender}"):
            return
        if channel == "facebook" and not core.inbox_get(rid, channel, sender).get("paused"):
            try:
                requests.post(f"{GRAPH_URL}/me/messages", timeout=10,
                              json={"recipient": {"id": sender}, "sender_action": "typing_on"},
                              headers={"Authorization": "Bearer " + page_token(rid)})
            except requests.RequestException:
                pass
        reply, chips = answer(cfg, (rid, f"{channel}:{sender}"), text, channel)
        if reply is None:
            print(f"[META] {rid} {channel}: staff have taken this conversation over, AI stays silent")
            return
        meta_send(rid, channel, sender, reply, chips)
    except Exception as e:
        print("[META ERROR]", type(e).__name__, e)
        traceback.print_exc()


# ---------------------------------------------------------------------
#  WHATSAPP (WhatsApp Business Cloud API, from the same Meta app and the same webhook address)
#  Each restaurant has its own WhatsApp phone number ID. The token is WHATSAPP_TOKEN_<ID>,
#  or one shared WHATSAPP_TOKEN if all numbers are in the same WhatsApp Business account.
# ---------------------------------------------------------------------
def whatsapp_token_name(rid):
    return "WHATSAPP_TOKEN_" + re.sub(r"[^A-Z0-9]", "_", rid.upper())


def whatsapp_token(rid):
    return os.environ.get(whatsapp_token_name(rid), "") or os.environ.get("WHATSAPP_TOKEN", "")


def whatsapp_send(rid, phone_id, to, text):
    ok = True
    for part in split_text(text.replace("**", "*"), 3800) or ["Sorry, could you say that again?"]:
        r = requests.post(f"{GRAPH_URL}/{phone_id}/messages", timeout=15,
                          headers={"Authorization": "Bearer " + whatsapp_token(rid)},
                          json={"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"body": part}})
        if not r.ok:
            print(f"[WHATSAPP] send failed for {rid}: {r.status_code} {r.text[:300]}")
            ok = False
    return ok


def handle_whatsapp_message(phone_id, msg):
    try:
        sender = re.sub(r"\D", "", str(msg.get("from") or ""))
        mid = msg.get("id")
        if not sender or not phone_id:
            return
        with lock:
            if mid and mid in seen_messages:
                return
            seen_messages.append(mid)
        rid = restaurant_for("whatsapp", phone_id)
        if not rid:
            print(f"[WHATSAPP] message for a number that is not set up. In the admin, open the restaurant -> "
                  f"WhatsApp and set the phone number ID to {phone_id}")
            return
        cfg = core.chat_cfg(rid)
        if not whatsapp_token(rid):
            print(f"[WHATSAPP] {rid}: add {whatsapp_token_name(rid)} (or WHATSAPP_TOKEN) to the env file")
            return
        if msg.get("type") != "text":
            if cfg["ai"].get("whatsapp") and not too_many_messages(f"whatsapp:{sender}"):
                whatsapp_send(rid, phone_id, sender, "Sorry, I can only read text messages. Please type your message.")
            return
        text = str((msg.get("text") or {}).get("body") or "").strip()[:1000]
        if not text:
            return
        if not cfg["ai"].get("whatsapp"):
            core.inbox_add(rid, "whatsapp", sender, "customer", text)      # kept for staff to answer in Messages
            print(f"[WHATSAPP] {rid}: AI is OFF, message left for staff")
            return
        if too_many_messages(f"whatsapp:{sender}"):
            return
        reply, _ = answer(cfg, (rid, f"whatsapp:{sender}"), text, "whatsapp")
        if reply is None:
            print(f"[WHATSAPP] {rid}: staff have taken this conversation over, AI stays silent")
            return
        whatsapp_send(rid, phone_id, sender, reply)
    except Exception as e:
        print("[WHATSAPP ERROR]", type(e).__name__, e)
        traceback.print_exc()


@bp.route("/webhooks/meta", methods=["GET"])
def meta_verify():
    """Meta calls this once when you save the webhook address, to check it is really yours."""
    if (META_VERIFY_TOKEN and request.args.get("hub.mode") == "subscribe"
            and hmac.compare_digest(request.args.get("hub.verify_token", ""), META_VERIFY_TOKEN)):
        return Response(request.args.get("hub.challenge", ""), mimetype="text/plain")
    return "Wrong verify token", 403


@bp.route("/webhooks/meta", methods=["POST"])
def meta_webhook():
    raw = request.get_data()
    if not META_APP_SECRET:
        print("[META] message received but META_APP_SECRET is not set - ignored")
        return "META_APP_SECRET is not set", 503
    expected = "sha256=" + hmac.new(META_APP_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(request.headers.get("X-Hub-Signature-256", ""), expected):
        print("[META] message with a wrong signature - ignored")
        return "Bad signature", 403                         # not really from Meta
    try:
        data = json.loads(raw)
    except ValueError:
        return "Bad JSON", 400
    channel = {"page": "facebook", "instagram": "instagram"}.get(data.get("object"))
    if channel:
        for entry in data.get("entry", []):
            for event in entry.get("messaging", []):
                # answer in the background: Meta wants a reply to this request within a few seconds
                threading.Thread(target=handle_meta_message, args=(channel, entry.get("id"), event), daemon=True).start()
    elif data.get("object") == "whatsapp_business_account":
        for entry in data.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value") or {}
                phone_id = str((value.get("metadata") or {}).get("phone_number_id") or "")
                for msg in value.get("messages") or []:    # delivery receipts ("statuses") are ignored
                    threading.Thread(target=handle_whatsapp_message, args=(phone_id, msg), daemon=True).start()
    return "EVENT_RECEIVED", 200
