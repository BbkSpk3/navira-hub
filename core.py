# =====================================================================
#  core.py - where every restaurant's information lives
#
#  One restaurant = one folder in  data/restaurants/<id>/
#     site.json        the DRAFT  (what you are editing)
#     published.json   the LIVE copy (what customers see)
#     photos/          its photos
#     versions/        older copies, so any change can be undone
#
#  The website, the chat assistant, Facebook and Instagram all read
#  from this one place.
# =====================================================================

import copy
import hashlib
from urllib.parse import quote_plus
import json
import os
import re
import shutil
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader, select_autoescape

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(HERE, "data")
R_DIR = os.path.join(DATA_DIR, "restaurants")
SEED_DIR = os.path.join(HERE, "seed")
SITE_TEMPLATE_DIR = os.path.join(HERE, "site_template")
KEEP_VERSIONS = 40

write_lock = threading.RLock()
_SALT = os.urandom(16).hex()

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# ---------------------------------------------------------------------
#  DESIGN SYSTEM
#  A "style" is only a starting point. Every part of it can be overridden
#  per restaurant in  site.json -> "design"  (by hand, or by the AI).
# ---------------------------------------------------------------------
# name -> (Google Fonts request, CSS font stack)
FONTS = {
    "Playfair Display":   ("Playfair+Display:wght@500;600;700", '"Playfair Display", Georgia, serif'),
    "Bodoni Moda":        ("Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,600;1,6..96,400;1,6..96,500", '"Bodoni Moda", Didot, Georgia, serif'),
    "Cormorant Garamond": ("Cormorant+Garamond:wght@400;500;600;700", '"Cormorant Garamond", Georgia, serif'),
    "DM Serif Display":   ("DM+Serif+Display", '"DM Serif Display", Georgia, serif'),
    "Fraunces":           ("Fraunces:wght@500;600;700", '"Fraunces", Georgia, serif'),
    "Lora":               ("Lora:wght@400;500;600;700", '"Lora", Georgia, serif'),
    "Merriweather":       ("Merriweather:wght@400;700", '"Merriweather", Georgia, serif'),
    "Libre Baskerville":  ("Libre+Baskerville:wght@400;700", '"Libre Baskerville", Georgia, serif'),
    "Cinzel":             ("Cinzel:wght@500;600;700", '"Cinzel", Georgia, serif'),
    "Roboto Slab":        ("Roboto+Slab:wght@400;600;700", '"Roboto Slab", Georgia, serif'),
    "Bebas Neue":         ("Bebas+Neue", '"Bebas Neue", Impact, sans-serif'),
    "Oswald":             ("Oswald:wght@400;500;600;700", '"Oswald", "Arial Narrow", sans-serif'),
    "Poppins":            ("Poppins:wght@400;500;600;700", '"Poppins", Arial, sans-serif'),
    "DM Sans":            ("DM+Sans:wght@400;500;600;700", '"DM Sans", Arial, sans-serif'),
    "Inter":              ("Inter:wght@400;500;600;700", '"Inter", Arial, sans-serif'),
    "Montserrat":         ("Montserrat:wght@400;500;600;700", '"Montserrat", Arial, sans-serif'),
    "Raleway":            ("Raleway:wght@400;500;600;700", '"Raleway", Arial, sans-serif'),
    "Nunito Sans":        ("Nunito+Sans:wght@400;600;700", '"Nunito Sans", Arial, sans-serif'),
    "Instrument Sans":    ("Instrument+Sans:wght@400;500;600", '"Instrument Sans", "Helvetica Neue", Arial, sans-serif'),
    "Work Sans":          ("Work+Sans:wght@400;500;600", '"Work Sans", Arial, sans-serif'),
    "Josefin Sans":       ("Josefin+Sans:wght@400;600;700", '"Josefin Sans", Arial, sans-serif'),
    "Space Grotesk":      ("Space+Grotesk:wght@400;500;600;700", '"Space Grotesk", Arial, sans-serif'),
}
# Every choice below can be set per restaurant in  site.json -> "design"  ("" = follow the template)
OPTIONS = {
    "buttons": {"solid": "Filled", "outline": "Outline", "pill": "Rounded pill", "contrast": "Black / white"},
    "hero":    {"cover": "Photo behind the words", "center": "Photo behind, words centred",
                "split": "Words left, photo right", "plain": "No photo, colour block"},
    "nav":     {"plain": "Same as the page", "brand": "Main colour bar", "clear": "See-through over the photo"},
    "offers":  {"strip": "Thin strip", "cards": "Big cards", "banner": "Wide banners, one under another",
                "split": "Photo one side, words the other", "slider": "Cards you slide sideways", "tickets": "Coupons with a dashed edge",
                "rows": "Simple rows with lines", "duo": "Two big tiles per row", "lead": "First offer big, the rest small",
                "dark": "Dark band with glowing cards"},
    "festive": {"side": "Photo right of the words", "side-left": "Photo left of the words", "top": "Photo above the words",
                "background": "Photo behind the words", "center": "Centred, no photo", "card": "A card floating on the page",
                "banner": "Slim banner with a button", "frame": "Poster with a double frame",
                "menu": "Words left, set menus in a card on the right", "stripe": "Left aligned with a colour stripe"},
    "about":   {"image-left": "Photo left", "image-right": "Photo right", "center": "Centred, photo on top"},
    "features": {"cards": "Cards", "lines": "Grid with thin lines", "tiles": "Photo tiles with words on top",
                 "numbered": "Big numbers 01, 02, 03", "rows": "Rows: small photo left, words right",
                 "zigzag": "Big rows, photo left then right", "round": "Round photos, centred words",
                 "minimal": "No boxes, a line on top", "slider": "Cards you slide sideways", "outline": "Outlined cards with a colour top"},
    "menu":    {"columns": "Two columns", "list": "One centred list", "cards": "Cards", "compact": "Compact (small, dotted lines)",
                "photo": "Photo cards (big dish photos)", "thumbs": "Rows with a small photo", "boxed": "Each section in its own box",
                "banded": "Section names on a colour band", "sidebar": "Section name at the side, dishes beside it",
                "accordion": "Sections open when tapped"},
    "gallery": {"grid": "Even grid", "masonry": "Mixed sizes", "strip": "Sideways scrolling strip",
                "slider": "One big photo that changes by itself", "large": "Three big photos per row", "polaroid": "Tilted photo prints",
                "columns": "Columns, natural photo shapes", "feature": "One big photo with small ones", "wide": "Two wide photos per row",
                "tight": "Small photos, no gaps"},
    "reviews": {"cards": "Cards on the main colour", "big": "Large quotes, centred",
                "slider": "One review at a time, slides by itself", "carousel": "Row of cards that slides by itself",
                "light": "Light cards with stars", "bubbles": "Speech bubbles", "wall": "Wall of reviews (columns)",
                "split": "Score on the left, reviews on the right", "lines": "Simple list with lines", "spot": "One big review, the rest small"},
    "faq":     {"accordion": "One column", "columns": "Two columns", "cards": "Each question in a card",
                "open": "All answers showing", "numbered": "Numbered questions", "split": "Heading left, questions right",
                "boxed": "All in one box", "grid": "Grid of answer cards", "band": "On the main colour", "plain": "Big questions, no lines"},
    "visit":   {"map-right": "Map on the right", "map-left": "Map on the left", "stacked": "Map underneath, full width",
                "map-top": "Map on top, full width", "cards": "Three cards: hours, contact, map", "overlay": "Big map with a card on top",
                "nomap": "No map: hours and contact side by side", "panel": "Colour panel with hours, map beside it",
                "compact": "Small and tidy, three columns", "buttons": "Big Call / Directions / Email buttons first"},
    "menu_nav": {"slide": "A row you slide sideways", "burger": "A ☰ button that opens the list"},
    "nav_cta": {"both": "Order online + Book a table", "book": "Only Book a table", "order": "Only Order online", "none": "No buttons"},
    "marquee": {"on": "On", "off": "Off"},
    "motion":  {"none": "No movement", "subtle": "Gentle (fade in while scrolling)", "lively": "Lively (more movement)"},
    "booking": {"popup": "Booking form inside the website (Navira)", "link": "Open the booking link instead"},
    "booking_style": {"steps": "Step by step, in the middle of the screen", "side": "Panel sliding in from the right",
                      "full": "Full screen, with a summary at the side", "quick": "Quick form, everything on one screen"},
}
# name -> what the picker shows + every default. Colours are only a suggestion ("Use these colours" button).
def _preset(label, about, bg, text, heading, body, radius, buttons, hero, nav, offers, ab, feat, menu, gal, rev, faq, visit, marquee, motion, colors):
    return {"label": label, "about": about, "bg": bg, "text": text, "heading_font": heading, "body_font": body, "radius": radius,
            "buttons": buttons, "hero": hero, "nav": nav, "offers": offers, "about_layout": ab, "features": feat, "menu": menu,
            "gallery": gal, "reviews": rev, "faq": faq, "visit": visit, "marquee": marquee, "motion": motion,
            "booking": "popup", "booking_style": "steps", "colors": colors}


PRESETS = {
    "elegant": _preset("Elegant", "Classic serif, photo behind the words", "#ffffff", "#1d2125", "Playfair Display", "Poppins", 4,
                       "solid", "cover", "plain", "strip", "image-left", "cards", "columns", "grid", "slider", "accordion", "map-right", "off", "subtle", ["#25425c", "#c49a3c"]),
    "modern":  _preset("Modern", "Clean and rounded, menu in cards", "#ffffff", "#16181d", "DM Sans", "DM Sans", 14,
                       "solid", "cover", "plain", "cards", "image-right", "cards", "cards", "masonry", "carousel", "columns", "map-right", "off", "subtle", ["#2447d6", "#ff7a59"]),
    "warm":    _preset("Warm", "Cosy cream background, friendly serif", "#fffaf2", "#2a211a", "Fraunces", "Nunito Sans", 10,
                       "solid", "cover", "brand", "strip", "image-right", "cards", "columns", "grid", "slider", "accordion", "map-right", "off", "subtle", ["#8a3b1f", "#e0a83a"]),
    "bold":    _preset("Dark & bold", "Black, big headlines, like The Bell", "#0b0b0c", "#f4f4f2", "Bodoni Moda", "Instrument Sans", 0,
                       "contrast", "split", "plain", "cards", "image-left", "lines", "columns", "grid", "big", "accordion", "map-right", "on", "lively", ["#f4f4f2", "#d0242d"]),
    "minimal": _preset("Minimal", "White space, thin lines, one-list menu", "#ffffff", "#111111", "Inter", "Inter", 0,
                       "outline", "split", "plain", "cards", "center", "lines", "list", "masonry", "big", "accordion", "stacked", "off", "subtle", ["#111111", "#b08d57"]),
    "street":  _preset("Street food", "Loud, tall letters, moving words", "#fff7e6", "#1a1a1a", "Bebas Neue", "Work Sans", 8,
                       "pill", "center", "brand", "cards", "image-right", "tiles", "cards", "strip", "carousel", "columns", "map-left", "on", "lively", ["#e63b2e", "#ffc533"]),
    "luxe":    _preset("Luxe", "Dark navy and gold, fine dining", "#0e1420", "#f3ecdf", "Cormorant Garamond", "Montserrat", 2,
                       "outline", "center", "clear", "strip", "image-right", "tiles", "list", "masonry", "big", "accordion", "map-right", "off", "subtle", ["#c8a45a", "#c8a45a"]),
    "fresh":   _preset("Fresh", "Light green, soft round shapes", "#f4f8f2", "#1c2a22", "DM Serif Display", "DM Sans", 22,
                       "pill", "split", "plain", "cards", "image-left", "cards", "cards", "grid", "carousel", "columns", "map-left", "off", "subtle", ["#2f6b4f", "#f2a541"]),
    "pub":     _preset("Classic pub", "Traditional, sturdy letters, colour bar", "#f6efe2", "#2b2118", "Roboto Slab", "Nunito Sans", 6,
                       "solid", "cover", "brand", "strip", "image-left", "cards", "compact", "grid", "carousel", "columns", "map-right", "off", "subtle", ["#5a1e1e", "#d9a441"]),
    "bistro":  _preset("Bistro", "Soft and airy, centred, sideways gallery", "#fbf6f3", "#2c2224", "Lora", "Josefin Sans", 16,
                       "solid", "center", "clear", "cards", "center", "tiles", "list", "strip", "big", "accordion", "stacked", "off", "subtle", ["#7b2d3b", "#c98b5e"]),
}
DESIGN_KEYS = ("buttons", "hero", "nav", "offers", "about", "features", "menu", "gallery", "reviews", "faq", "visit",
               "marquee", "motion", "booking", "booking_style", "festive", "menu_nav", "nav_cta")
EXTRA_DEFAULTS = {"festive": "", "menu_nav": "slide", "nav_cta": "both"}      # not set by the templates
# new layouts are built on top of one of the first styles (the <body> class), so every template still fits them
OFFERS_BASE = {"strip": "strip"}                                              # everything else: "cards"
MENU_BASE = {"columns": "columns", "list": "list", "cards": "cards", "compact": "compact", "photo": "cards", "thumbs": "columns",
             "boxed": "columns", "banded": "columns", "sidebar": "list", "accordion": "columns"}

# Links: the restaurant's own ordering comes first; the delivery apps are shown smaller, underneath.
ORDER_PLATFORMS = {"just_eat": "Just Eat", "uber_eats": "Uber Eats", "deliveroo": "Deliveroo", "foodhub": "Foodhub"}
SOCIALS = {"facebook": "Facebook", "instagram": "Instagram", "tiktok": "TikTok", "youtube": "YouTube", "x": "X (Twitter)",
           "whatsapp": "WhatsApp", "tripadvisor": "Tripadvisor", "snapchat": "Snapchat", "threads": "Threads", "linkedin": "LinkedIn"}
# The line at the very bottom of every website.
CREDITS = {"full": "Website, ordering & booking by Navira Technology", "website": "Website by Navira Technology",
           "powered": "Powered by Navira Technology", "name": "Navira Technology", "custom": "My own words", "none": "Show nothing"}
CREDIT_URL = "https://naviratechnology.com"
# Buttons that can sit in the bar at the bottom of the screen on phones.
MBAR = {"call": "Call", "order": "Order", "book": "Book", "menu": "Menu", "directions": "Directions", "whatsapp": "WhatsApp", "email": "Email"}
STYLES = PRESETS            # older name, still used in a few places
BUILTIN_SECTIONS = {"festive": "Festive", "offers": "Offers", "about": "About", "features": "Feature boxes", "menu": "Menu",
                    "gallery": "Gallery", "reviews": "Reviews", "faq": "Questions", "order": "Order online", "visit": "Hours, map & contact"}
IMAGE_POS = {"top": "Above the text", "bottom": "Under the text", "background": "Behind the text"}
SECTION_LAYOUTS = {"image-top": "Photo above the text", "image-bottom": "Photo under the text", "background": "Photo behind the text",
                   "image-right": "Text left, photo right", "image-left": "Photo left, text right",
                   "center": "Centred text", "cards": "Cards (uses the items)"}
SECTION_BANDS = {"": "Normal", "soft": "Soft background", "brand": "Main colour background"}

# Festive section: the list of festivals and their colours is shared by every restaurant and is
# edited in the admin (Festivals page). It is kept in DATA_DIR/festivals.json; these are the starting ones.
FESTIVAL_DEFAULTS = {
    "christmas": {"name": "Christmas", "bg": "#143326", "bg2": "#0b2018", "accent": "#e3b55a", "ink": "#fdf8ec"},
    "newyear": {"name": "New Year", "bg": "#141a33", "bg2": "#090c1c", "accent": "#f0cf7a", "ink": "#fdf8ec"},
    "valentines": {"name": "Valentine's Day", "bg": "#7a1f3d", "bg2": "#4a0f24", "accent": "#ffc2d1", "ink": "#fdf8ec"},
    "mothers": {"name": "Mother's Day", "bg": "#8a4a63", "bg2": "#5d2f43", "accent": "#ffe0ea", "ink": "#fdf8ec"},
    "easter": {"name": "Easter", "bg": "#2f5d50", "bg2": "#1f4238", "accent": "#f7e08a", "ink": "#fdf8ec"},
    "eid": {"name": "Eid", "bg": "#0f4d43", "bg2": "#07302a", "accent": "#e8c66a", "ink": "#fdf8ec"},
    "dashain": {"name": "Dashain", "bg": "#8c1c1c", "bg2": "#560f0f", "accent": "#f6c453", "ink": "#fdf8ec"},
    "tihar": {"name": "Tihar / Diwali", "bg": "#3b1a5a", "bg2": "#220d38", "accent": "#ffb347", "ink": "#fdf8ec"},
    "halloween": {"name": "Halloween", "bg": "#1b1410", "bg2": "#0d0907", "accent": "#ff8a1f", "ink": "#fdf8ec"},
}
FESTIVAL_COLOURS = ("bg", "bg2", "accent", "ink")
CUSTOM_FESTIVAL = "Other (uses the restaurant's colours)"
FESTIVALS_FILE = os.path.join(DATA_DIR, "festivals.json")
_fest_cache = {"mtime": None, "data": None}


def festivals():
    """The festival list: {key: {name, bg, bg2, accent, ink}}. Read from the file, or the starting list."""
    try:
        mtime = os.path.getmtime(FESTIVALS_FILE)
    except OSError:
        return copy.deepcopy(FESTIVAL_DEFAULTS)
    if _fest_cache["mtime"] != mtime:
        try:
            with open(FESTIVALS_FILE, encoding="utf-8") as f:
                data = json.load(f)
            _fest_cache.update(mtime=mtime, data=data if isinstance(data, dict) and data else copy.deepcopy(FESTIVAL_DEFAULTS))
        except (OSError, ValueError):
            return copy.deepcopy(FESTIVAL_DEFAULTS)
    return copy.deepcopy(_fest_cache["data"])


def festival_names():
    """{key: name} for the dropdowns, with 'custom' (the restaurant's own colours) at the end."""
    return {**{k: v["name"] for k, v in festivals().items()}, "custom": CUSTOM_FESTIVAL}


def festival_label(theme):
    return festival_names().get(theme, "Festive").split(" (")[0]


def save_festivals(rows):
    """Save the whole festival list from the admin. Returns (list of problems, saved list)."""
    if not isinstance(rows, list):
        return ["The festival list is in the wrong format."], None
    if len(rows) > 60:
        return ["That is too many festivals (max 60)."], None
    out, problems = {}, []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = re.sub(r"[<>\x00-\x1f]", "", str(row.get("name") or "")).strip()[:40]
        if not name:
            problems.append("Every festival needs a name.")
            continue
        key = str(row.get("key") or "")
        if not re.fullmatch(r"[a-z0-9-]{1,40}", key) or key == "custom":
            key = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:30] or "festival"
        base, n = key, 2
        while key in out or key == "custom":
            key, n = f"{base}-{n}", n + 1
        item = {"name": name}
        for c in FESTIVAL_COLOURS:
            value = str(row.get(c) or "").strip().lower()
            if not re.fullmatch(r"#[0-9a-f]{6}", value):
                problems.append(f"'{name}': choose a colour for each of the four boxes.")
                break
            item[c] = value
        else:
            out[key] = item
    if any(n.lower() in [v["name"].lower() for k2, v in out.items() if k2 != k] for k, n in ((k, v["name"]) for k, v in out.items())):
        problems.append("Two festivals have the same name.")
    if problems:
        return list(dict.fromkeys(problems)), None
    os.makedirs(DATA_DIR, exist_ok=True)
    _write(FESTIVALS_FILE, out)
    return [], out


def reset_festivals():
    if os.path.exists(FESTIVALS_FILE):
        os.remove(FESTIVALS_FILE)
    _fest_cache.update(mtime=None, data=None)


def festival_style(theme):
    """The inline colours for the festive section. Empty for 'custom' (the stylesheet then uses the restaurant's colours)."""
    f = festivals().get(theme)
    if not f:
        return ""
    return (f"--f-bg:{f['bg']};--f-bg2:{f['bg2']};--f-accent:{f['accent']};--f-ink:{f['ink']};"
            f"--f-dot:color-mix(in srgb,{f['accent']} 50%,transparent)")


def festivals_in_use():
    """{festival key: [restaurant names]} so the admin can see what a change affects."""
    used = {}
    for rid in ids():
        try:
            s = load(rid)
        except Exception:
            continue
        used.setdefault(s["festive"]["theme"], []).append(s["name"] or rid)
    return used


TAG_NAMES = {"V": "Vegetarian", "VG": "Vegan", "GF": "Gluten free", "H": "Halal", "HOT": "Spicy", "NEW": "New"}

DEFAULTS = {
    "name": "", "tagline": "", "headline": "", "intro": "", "about": "",
    "logo": "", "hero_image": "", "about_image": "",
    "domain": "",
    "theme": {"style": "elegant", "color": "#25425c", "accent": "#c49a3c"},
    "contact": {"phone": "", "email": "", "address": ""},
    "hours": [[d, "12:00", "22:00"] for d in DAYS], "hours_note": "",
    "links": {"order_url": "", "booking_url": "", "facebook": "", "instagram": "", "google_reviews": "",
              "order_label": "", "order_note": "",          # the restaurant's own ordering: button words + a line under it
              "just_eat": "", "uber_eats": "", "deliveroo": "", "foodhub": "",
              "tiktok": "", "youtube": "", "x": "", "whatsapp": "", "tripadvisor": "", "snapchat": "", "threads": "", "linkedin": ""},
    "credit": {"style": "full", "text": ""},               # the Navira Technology line in the footer
    "offers": [], "features": [], "menu": [], "menu_note": "", "gallery": [],
    "reviews": [], "reviews_summary": {"rating": "", "count": "", "source": "Google"},
    "faq": [], "seo": {"description": ""},
    "location": {"country": "", "region": ""},       # where the restaurant is: used to filter the dashboard
    "design": {                              # "" = follow the chosen style
        "heading_font": "", "body_font": "", "bg": "", "text": "", "radius": "",
        "buttons": "", "hero": "", "nav": "", "offers": "", "about": "", "features": "", "menu": "", "gallery": "",
        "reviews": "", "faq": "", "visit": "", "marquee": "", "motion": "", "booking": "", "booking_style": "",
        "festive": "", "menu_nav": "", "nav_cta": "",
        "mbar": [],                          # buttons in the bar at the bottom on phones ([] = Call, Order, Book; ["none"] = no bar)
        "nav_show": [],                      # sections named in the menu bar ([] = the usual ones)
        "pages": [],                         # sections that get their own page, e.g. ["menu", "gallery"]
        "order": [], "hidden": [],           # section order + sections to hide
        "titles": {},                        # {"menu": {"eyebrow": "...", "title": "...", "nav": "..."}}
        "custom_css": "",
    },
    "sections": [],                          # your own sections (see normalise_section)
    "privacy": "",                           # privacy notice text (own page, linked in the footer)
    "festive": {
        "enabled": False, "theme": "christmas", "label": "", "title": "", "text": "", "dates": "",
        "image_pos": "side",                 # side | top | background
        "start": "", "end": "",              # optional YYYY-MM-DD: the section shows only between these dates
        "image": "", "button_text": "", "button_url": "", "banner": True,
        "items": [],                         # e.g. set menus: {"title", "price", "text"}
    },
    "chat": {
        "navira_slug": "", "max_party": 15, "days_ahead": 60,
        "assistant_name": "", "greeting": "",
        "quick_replies": ["Book a table", "Opening times", "See the menu", "Offers"],
        "extra_info": "", "allowed_websites": [],
        "facebook_page_id": "", "instagram_id": "", "whatsapp_phone_id": "",
        "monthly_limit": 0,                   # most AI replies in one month (0 = use AI_MONTHLY_LIMIT, or no limit)
        "ai": {"website": True, "facebook": True, "instagram": True, "whatsapp": False},
    },
    "cookies": {"enabled": True, "text": ""},     # small notice at the bottom of the website
}
SUB_DICTS = ("theme", "contact", "links", "reviews_summary", "seo", "chat", "festive", "design", "cookies", "credit", "location")


# ---------------------------------------------------------------------
#  Files
# ---------------------------------------------------------------------
def valid_id(rid):
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9-]{1,39}", str(rid or "")))


def rpath(rid, *parts):
    if not valid_id(rid):
        raise ValueError("Bad restaurant id")
    return os.path.join(R_DIR, rid, *parts)


def ids():
    if not os.path.isdir(R_DIR):
        return []
    return sorted(d for d in os.listdir(R_DIR) if valid_id(d) and os.path.isfile(os.path.join(R_DIR, d, "site.json")))


def exists(rid):
    return valid_id(rid) and os.path.isfile(rpath(rid, "site.json"))


def _read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)                     # never leaves a half-written file


def merge(data):
    """Fill in anything missing so the rest of the code never crashes on a missing field."""
    s = copy.deepcopy(DEFAULTS)
    for k, v in (data or {}).items():
        if k in SUB_DICTS and isinstance(v, dict):
            s[k].update(v)
        elif k in DEFAULTS or k == "name":
            s[k] = v
    if isinstance((data or {}).get("chat"), dict) and isinstance(data["chat"].get("ai"), dict):
        s["chat"]["ai"] = {**DEFAULTS["chat"]["ai"], **data["chat"]["ai"]}
    if s["theme"].get("style") not in STYLES:
        s["theme"]["style"] = "elegant"
    if s["festive"].get("theme") not in festival_names():      # that festival was removed from the list
        s["festive"]["theme"] = "custom"
    s["design"]["custom_css"] = clean_css(s["design"].get("custom_css"))
    if isinstance(s["sections"], list):
        used, out = set(BUILTIN_SECTIONS), []
        for c in s["sections"][:12]:
            if isinstance(c, dict):
                out.append(normalise_section(c, used))
        s["sections"] = out
    return s


def normalise_section(c, used):
    """One of your own sections. Gives it a safe id (used in the web address as #id)."""
    sid = re.sub(r"[^a-z0-9]+", "-", str(c.get("id") or c.get("nav") or c.get("title") or "section").lower()).strip("-")[:30] or "section"
    base, n = sid, 2
    while sid in used:
        sid = f"{base}-{n}"
        n += 1
    used.add(sid)
    items = []
    for it in (c.get("items") or [])[:24]:
        if isinstance(it, dict):
            row = {k: str(it.get(k) or "") for k in ("title", "text", "price", "image")}
            row["image_pos"] = it.get("image_pos") if it.get("image_pos") in IMAGE_POS else "top"
            items.append(row)
    return {
        "id": sid, "nav": str(c.get("nav") or "")[:24], "eyebrow": str(c.get("eyebrow") or "")[:60],
        "title": str(c.get("title") or "")[:120], "text": str(c.get("text") or "")[:3000],
        "image": str(c.get("image") or ""),
        "layout": c.get("layout") if c.get("layout") in SECTION_LAYOUTS else "image-right",
        "band": c.get("band") if c.get("band") in SECTION_BANDS else "",
        "items": items, "button_text": str(c.get("button_text") or "")[:40], "button_url": str(c.get("button_url") or "")[:300],
    }


def load(rid, published=False):
    name = "published.json" if published else "site.json"
    path = rpath(rid, name)
    if published and not os.path.isfile(path):
        return None
    return merge(_read(path))


def check(s):
    """Simple checks so a mistake never reaches the live website."""
    problems = []
    if not str(s.get("name") or "").strip():
        problems.append("The restaurant name is missing.")
    for key in ("color", "accent"):
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", str(s["theme"].get(key, ""))):
            problems.append(f"Theme {key} must look like #25425c.")
    if not isinstance(s["hours"], list):
        problems.append("Opening hours are in the wrong format.")
    else:
        for h in s["hours"]:
            if not (isinstance(h, list) and len(h) == 3):
                problems.append("Each opening-hours line must be [day, open, close].")
                break
            for t in h[1:]:
                if t and not re.fullmatch(r"\d{2}:\d{2}", str(t)):
                    problems.append(f"Time '{t}' on {h[0]} must look like 17:30.")
    if not isinstance(s["menu"], list):
        problems.append("The menu is in the wrong format.")
    else:
        for c in s["menu"]:
            if not isinstance(c, dict) or not str(c.get("category") or "").strip() or not isinstance(c.get("items"), list):
                problems.append("Every menu section needs a name and a list of dishes.")
                break
            for it in c["items"]:
                if not isinstance(it, dict) or not str(it.get("name") or "").strip():
                    problems.append(f"A dish in '{c['category']}' has no name.")
                    break
                try:
                    float(it.get("price"))
                except (TypeError, ValueError):
                    problems.append(f"'{it.get('name')}' in '{c['category']}' needs a price (numbers only).")
                    break
    for key in ("offers", "features", "gallery", "reviews", "faq"):
        if not isinstance(s[key], list):
            problems.append(f"'{key}' is in the wrong format.")
    dz = s["design"]
    for key, allowed in OPTIONS.items():
        if dz.get(key) and dz[key] not in allowed:
            problems.append(f"Design '{key}' must be one of: {', '.join(allowed)}.")
    for key in ("heading_font", "body_font"):
        if dz.get(key) and dz[key] not in FONTS:
            problems.append(f"The font '{dz[key]}' is not in the list. Choose from: {', '.join(FONTS)}.")
    for key in ("bg", "text"):
        if dz.get(key) and not re.fullmatch(r"#[0-9a-fA-F]{6}", str(dz[key])):
            problems.append(f"Design {key} colour must look like #ffffff.")
    if dz.get("radius") not in ("", None):
        try:
            if not 0 <= float(dz["radius"]) <= 40:
                raise ValueError
        except (TypeError, ValueError):
            problems.append("Corner roundness must be a number from 0 to 40.")
    for key in ("mbar", "nav_show"):
        if not isinstance(dz.get(key), list):
            problems.append(f"Design '{key}' must be a list.")
    if isinstance(dz.get("mbar"), list) and any(k not in MBAR and k != "none" for k in dz["mbar"]):
        problems.append(f"The phone bar buttons must be from: {', '.join(MBAR)} (or 'none').")
    if s["credit"].get("style") not in CREDITS:
        problems.append(f"The footer credit must be one of: {', '.join(CREDITS)}.")
    if not isinstance(dz.get("pages"), list):
        problems.append("'pages' must be a list of section names.")
    if not isinstance(dz.get("order"), list) or not isinstance(dz.get("hidden"), list) or not isinstance(dz.get("titles"), dict):
        problems.append("The section order is in the wrong format.")
    if len(str(dz.get("custom_css") or "")) > 20000:
        problems.append("The custom CSS is too long (max 20,000 characters).")
    if not isinstance(s["sections"], list):
        problems.append("'sections' is in the wrong format.")
    else:
        for c in s["sections"]:
            if c.get("button_url") and not re.match(r"(https?://|#|tel:|mailto:)", c["button_url"]):
                problems.append(f"The button link in '{c.get('title') or c['id']}' must start with https://")
    loc = s["location"]
    if loc.get("country") and loc["country"] not in COUNTRIES:
        problems.append("Choose the country from the list.")
    if len(str(loc.get("region") or "")) > 60:
        problems.append("The region is too long (max 60 characters).")
    try:
        if int(s["chat"].get("monthly_limit") or 0) < 0:
            raise ValueError
    except (TypeError, ValueError):
        problems.append("The monthly AI limit must be a number (0 for no limit).")
    f = s["festive"]
    if f.get("theme") not in festival_names():
        problems.append("Choose a festival from the list.")
    for key in ("start", "end"):
        if f.get(key) and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(f[key])):
            problems.append(f"The festive {key} date must look like 2026-12-01.")
    if f.get("start") and f.get("end") and str(f["start"]) > str(f["end"]):
        problems.append("The festive end date is before the start date.")
    if f.get("button_url") and not re.match(r"(https?://|#|tel:|mailto:)", str(f["button_url"])):
        problems.append("The festive button link must start with https://")
    if not isinstance(f.get("items"), list):
        problems.append("The festive items are in the wrong format.")
    if f.get("enabled") and not str(f.get("title") or "").strip():
        problems.append("The festive section needs a title before it can be turned on.")
    for o in s["offers"] if isinstance(s["offers"], list) else []:
        if isinstance(o, dict) and o.get("button_url") and not re.match(r"(https?://|#|tel:|mailto:|/)", str(o["button_url"])):
            problems.append(f"The link on the offer '{o.get('title', '')}' must start with https://")
    for key in ("links",):
        for name, url in s[key].items():
            if name in ("order_label", "order_note"):       # words, not links
                continue
            if url and not re.match(r"https?://", str(url)):
                label = ORDER_PLATFORMS.get(name) or SOCIALS.get(name) or name.replace("_", " ")
                problems.append(f"The {label} link must start with https://")
    return problems


def save(rid, data, note="Edited"):
    """Save the draft. The previous draft is kept in versions/ so it can be restored."""
    s = merge(data)
    problems = check(s)
    if problems:
        raise ValueError(" ".join(problems))
    with write_lock:
        path = rpath(rid, "site.json")
        if os.path.isfile(path):
            old = _read(path)
            if merge(old) == s:
                return s                                    # nothing changed
            vdir = rpath(rid, "versions")
            os.makedirs(vdir, exist_ok=True)
            _write(os.path.join(vdir, f"{int(time.time() * 1000)}.json"), {"note": note, "data": old})
            for old_file in sorted(os.listdir(vdir))[:-KEEP_VERSIONS]:
                os.remove(os.path.join(vdir, old_file))
        _write(path, s)
    return s


def publish(rid):
    with write_lock:
        s = load(rid)
        _write(rpath(rid, "published.json"), s)
    return s


def unpublished(rid):
    live = load(rid, published=True)
    return live is None or live != load(rid)


def is_live(rid):
    return os.path.isfile(rpath(rid, "published.json"))


def is_offline(rid):
    """Switched off in the admin: the website address shows 'not available' until it is switched on again."""
    return os.path.isfile(rpath(rid, "offline.txt"))


def set_offline(rid, off):
    path = rpath(rid, "offline.txt")
    with write_lock:
        if off:
            with open(path, "w", encoding="utf-8") as f:
                f.write("This website was switched off in the admin.\n")
        elif os.path.isfile(path):
            os.remove(path)


def versions(rid):
    vdir = rpath(rid, "versions")
    out = []
    if os.path.isdir(vdir):
        for f in sorted(os.listdir(vdir), reverse=True):
            if f.endswith(".json"):
                try:
                    note = _read(os.path.join(vdir, f)).get("note", "")
                except (OSError, ValueError):
                    continue
                when = datetime.fromtimestamp(int(f[:-5]) / 1000)
                out.append({"id": f[:-5], "when": when.strftime("%d %b %Y, %H:%M"), "note": note})
    return out


def restore(rid, version_id):
    if not re.fullmatch(r"\d{10,16}", str(version_id)):
        raise ValueError("Bad version")
    old = _read(rpath(rid, "versions", f"{version_id}.json"))
    return save(rid, old["data"], "Restored an older version")


def set_switch(rid, channel, on):
    """AI on/off works straight away (no publish needed) and is not a 'version'."""
    with write_lock:
        for name in ("site.json", "published.json"):
            path = rpath(rid, name)
            if os.path.isfile(path):
                d = _read(path)
                d.setdefault("chat", {}).setdefault("ai", {})[channel] = bool(on)
                _write(path, d)


# Where a restaurant is. Chosen when the restaurant is added; the dashboard can be filtered by it.
COUNTRIES = ["Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Canada", "Cape Verde", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "DR Congo", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"]
# Regions offered for a country (any other words can be typed too).
REGIONS = {"United Kingdom": ["East Midlands", "East of England", "London", "North East England", "North West England", "South East England", "South West England", "West Midlands", "Yorkshire and the Humber", "Scotland", "Wales", "Northern Ireland"], "Nepal": ["Koshi", "Madhesh", "Bagmati", "Gandaki", "Lumbini", "Karnali", "Sudurpashchim"], "Ireland": ["Connacht", "Leinster", "Munster", "Ulster"], "Australia": ["Australian Capital Territory", "New South Wales", "Northern Territory", "Queensland", "South Australia", "Tasmania", "Victoria", "Western Australia"], "Canada": ["Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Nova Scotia", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan"]}


def create(rid, name, country="", region=""):
    if not valid_id(rid):
        raise ValueError("The short name can only use small letters, numbers and dashes (2 to 40 characters).")
    if exists(rid):
        raise ValueError("A restaurant with that short name already exists.")
    if country and country not in COUNTRIES:
        raise ValueError("Choose the country from the list.")
    os.makedirs(rpath(rid, "photos"), exist_ok=True)
    s = merge({"name": name, "headline": name, "seo": {"description": name},
               "location": {"country": country, "region": str(region or "").strip()[:60]}})
    _write(rpath(rid, "site.json"), s)
    return s


def photos(rid):
    pdir = rpath(rid, "photos")
    if not os.path.isdir(pdir):
        return []
    return sorted(f for f in os.listdir(pdir) if f.lower().rsplit(".", 1)[-1] in ("jpg", "jpeg", "png", "webp"))


def init():
    """First start: copy the example restaurants in, and put them live."""
    os.makedirs(R_DIR, exist_ok=True)
    if not os.path.isdir(SEED_DIR):
        return
    marker = os.path.join(DATA_DIR, "seeded.txt")           # examples are added once; a deleted one stays deleted
    done = set(open(marker, encoding="utf-8").read().split()) if os.path.isfile(marker) else set()
    for name in sorted(os.listdir(SEED_DIR)):
        if name.startswith("_") or not valid_id(name):
            continue
        if name in done or exists(name):
            if name not in done:
                with open(marker, "a", encoding="utf-8") as f:
                    f.write(name + "\n")
            continue
        with open(marker, "a", encoding="utf-8") as f:
            f.write(name + "\n")
        shutil.copytree(os.path.join(SEED_DIR, name), rpath(name))
        _write(rpath(name, "site.json"), merge(_read(rpath(name, "site.json"))))
        publish(name)
        print(f"[SETUP] added example restaurant: {name}")


# ---------------------------------------------------------------------
#  Website
# ---------------------------------------------------------------------
def money(v):
    try:
        return f"£{float(v):.2f}"
    except (TypeError, ValueError):
        return str(v)


def t12(t):
    try:
        h, m = map(int, str(t)[:5].split(":"))
    except ValueError:
        return str(t)
    return f"{h % 12 or 12}{':%02d' % m if m else ''}{'pm' if h >= 12 else 'am'}"


def tel(phone):
    d = "".join(c for c in str(phone) if c.isdigit() or c == "+")
    return "+44" + d[1:] if d.startswith("0") else d


_env = Environment(loader=FileSystemLoader(SITE_TEMPLATE_DIR), autoescape=select_autoescape(["html"]))
_env.filters.update(money=money, t12=t12, tel=tel)
ASSET_V = str(int(time.time()))


def _schema(s):
    short = {d: d[:2] for d in DAYS}
    data = {
        "@context": "https://schema.org", "@type": "Restaurant", "name": s["name"],
        "description": s["seo"]["description"] or s["intro"],
        "telephone": s["contact"]["phone"], "email": s["contact"]["email"], "address": s["contact"]["address"],
        "servesCuisine": s["tagline"],
        "openingHours": [f"{short.get(h[0], h[0][:2])} {h[1]}-{h[2]}" for h in s["hours"] if h[1]],
        "acceptsReservations": bool(s["links"]["booking_url"]),
    }
    try:
        if float(s["reviews_summary"].get("rating") or 0):
            data["aggregateRating"] = {"@type": "AggregateRating", "ratingValue": s["reviews_summary"]["rating"],
                                       "reviewCount": s["reviews_summary"].get("count") or 1}
    except (TypeError, ValueError):
        pass
    return json.dumps(data, ensure_ascii=False).replace("</", "<\\/")


def festive_on(s, today=None):
    """Is the festive section showing right now? (switched on, and inside its dates if dates are set)"""
    f = s["festive"]
    if not f.get("enabled") or not str(f.get("title") or "").strip():
        return False
    today = today or datetime.now(ZoneInfo("Europe/London")).strftime("%Y-%m-%d")
    if f.get("start") and today < str(f["start"]):
        return False
    if f.get("end") and today > str(f["end"]):
        return False
    return True


def _lum(hex_colour):
    try:
        r, g, b = (int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
    except (ValueError, TypeError):
        return 1.0
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, b)]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def on_colour(hex_colour):
    """Readable text colour (dark or white) to put on top of a colour."""
    return "#111418" if _lum(hex_colour) > 0.42 else "#ffffff"


def clean_css(css):
    """Custom CSS is allowed, but only CSS: nothing that can load outside files or run code."""
    css = str(css or "")[:20000].replace("<", "").replace("\\", "")
    css = re.sub(r"(?i)@import[^;]*;?", "", css)
    css = re.sub(r"(?i)(expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding)", "", css)

    def keep_url(m):
        inner = m.group(1).strip().strip("'\"").strip()
        return f'url("{inner}")' if re.match(r"(/media/[\w\-./]+|data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+)$", inner) else "none"
    return re.sub(r"(?i)url\s*\(([^)]*)\)", keep_url, css)


def booking_mode(s):
    """'popup' = the website's own booking form (needs a Navira slug); 'link' = open booking_url; '' = no booking."""
    want = s["design"].get("booking") or "popup"
    if want == "popup" and str(s["chat"]["navira_slug"] or "").strip():
        return "popup"
    return "link" if s["links"]["booking_url"] else ""


def design(s):
    """The finished design for one restaurant: the chosen template, with the restaurant's own changes on top."""
    preset = PRESETS[s["theme"]["style"]]
    dz = s["design"]
    d = {"preset": s["theme"]["style"], "brand": s["theme"]["color"], "accent": s["theme"]["accent"]}
    for key in ("bg", "text", "heading_font", "body_font"):
        d[key] = dz.get(key) or preset[key]
    for key in DESIGN_KEYS:
        default = preset["about_layout"] if key == "about" else preset.get(key, EXTRA_DEFAULTS.get(key, ""))
        d[key] = dz.get(key) if dz.get(key) in OPTIONS[key] else default
    if not d["festive"]:                      # not chosen: follow the older "where the photo goes" setting
        d["festive"] = s["festive"].get("image_pos") if s["festive"].get("image_pos") in ("side", "top", "background") else "side"
    try:
        d["radius"] = int(float(dz["radius"])) if dz.get("radius") not in ("", None) else preset["radius"]
    except (TypeError, ValueError):
        d["radius"] = preset["radius"]
    for key in ("heading_font", "body_font"):
        if d[key] not in FONTS:
            d[key] = preset[key]
    d["display"], d["body"] = FONTS[d["heading_font"]][1], FONTS[d["body_font"]][1]
    wanted = {d["heading_font"], d["body_font"]}
    families = [FONTS[n][0] for n in FONTS if n in wanted]
    if d["preset"] == "bold":
        families.append("DM+Mono:wght@400;500")
    d["fonts_url"] = "&".join("family=" + f for f in families)
    d["dark"] = _lum(d["bg"]) < 0.25
    d["on_brand"], d["on_accent"] = on_colour(d["brand"]), on_colour(d["accent"])
    d["marquee"] = d["marquee"] == "on"
    d["titles"] = dz.get("titles") if isinstance(dz.get("titles"), dict) else {}
    d["custom_css"] = clean_css(dz.get("custom_css"))
    d["booking"] = booking_mode(s)
    d["booking_style"] = dz.get("booking_style") if dz.get("booking_style") in OPTIONS["booking_style"] else preset["booking_style"]
    if d["offers"] == "strip" and any(isinstance(o, dict) and (o.get("image") or o.get("button_text")) for o in s["offers"]):
        d["offers"] = "cards"                 # offers with a photo or a button need room, so they show as cards
    d["offers_base"] = OFFERS_BASE.get(d["offers"], "cards")
    d["menu_base"] = MENU_BASE.get(d["menu"], "columns")
    return d


def order_links(s):
    """Online ordering. The restaurant's own ordering is the main button; delivery apps are listed smaller."""
    L = s["links"]
    others = [(name, str(L.get(k) or "").strip()) for k, name in ORDER_PLATFORMS.items() if str(L.get(k) or "").strip()]
    own = str(L.get("order_url") or "").strip()
    return {"own": own, "main": own or (others[0][1] if others else ""), "others": others,
            "label": str(L.get("order_label") or "").strip() or ("Order direct" if own else "Order online"),
            "note": str(L.get("order_note") or "").strip() or ("Order straight from us: the best prices, and it supports us directly." if own else "")}


def social_links(s):
    return [(k, name, str(s["links"].get(k) or "").strip()) for k, name in SOCIALS.items() if str(s["links"].get(k) or "").strip()]


def credit(s):
    """The footer line about Navira Technology: (words before the link, the link's words). Both empty = nothing."""
    c = s.get("credit") or {}
    style = c.get("style") if c.get("style") in CREDITS else "full"
    if style == "none":
        return ("", "")
    if style == "custom":
        return ("", str(c.get("text") or "").strip()[:120] or "Navira Technology")
    words = CREDITS[style]
    return (words[:-len("Navira Technology")], "Navira Technology")


def directions_url(s):
    a = str(s["contact"].get("address") or "").strip()
    return "https://www.google.com/maps/dir/?api=1&destination=" + quote_plus(f"{s['name']}, {a}") if a else ""


def mobile_bar(s):
    """The buttons at the bottom of the screen on phones, as chosen in the admin (only the ones that can work)."""
    picked = [k for k in s["design"].get("mbar") or [] if k in MBAR or k == "none"]
    if "none" in picked:
        return []
    picked = picked or ["call", "order", "book"]
    mode, out = booking_mode(s), []
    tel_no = tel(s["contact"]["phone"]) if s["contact"]["phone"] else ""
    wa = str(s["links"].get("whatsapp") or "").strip()
    for k in picked[:4]:
        if k == "call" and tel_no:
            out.append({"label": "Call", "href": "tel:" + tel_no})
        elif k == "order" and order_links(s)["main"]:
            out.append({"label": "Order", "href": order_links(s)["main"], "ext": True})
        elif k == "book" and mode == "popup":
            out.append({"label": "Book", "book": True})
        elif k == "book" and mode == "link":
            out.append({"label": "Book", "href": s["links"]["booking_url"], "ext": True})
        elif k == "menu" and s["menu"]:
            out.append({"label": "Menu", "menu": True})
        elif k == "directions" and directions_url(s):
            out.append({"label": "Directions", "href": directions_url(s), "ext": True})
        elif k == "whatsapp" and wa:
            out.append({"label": "WhatsApp", "href": wa, "ext": True})
        elif k == "email" and s["contact"]["email"]:
            out.append({"label": "Email", "href": "mailto:" + s["contact"]["email"]})
    if out:
        out[-1]["main"] = True
    return out


PAGE_TITLES = {"menu": "Menu", "gallery": "Gallery", "offers": "Offers", "about": "About us", "features": "What we offer",
               "reviews": "Reviews", "faq": "Questions", "visit": "Find us", "festive": "Festive", "book": "Book a table",
               "privacy": "Privacy", "order": "Order online"}


def section_state(s):
    """Shared facts about the sections: which exist, their order, which are hidden, which have their own page."""
    have = {"festive": festive_on(s), "offers": bool(s["offers"]), "about": True, "features": bool(s["features"]),
            "menu": bool(s["menu"]), "gallery": bool(s["gallery"]), "reviews": bool(s["reviews"]),
            "faq": bool(s["faq"]), "visit": True, "order": bool(order_links(s)["main"])}
    customs = {c["id"]: c for c in s["sections"]}
    default = ["festive", "offers", "about", "features", "menu", "gallery", "reviews", "faq", *customs, "order", "visit"]
    order = list(dict.fromkeys(k for k in s["design"]["order"] if k in default))
    for k in default:
        if k not in order:
            if "visit" in order and k != "visit":
                order.insert(order.index("visit"), k)
            else:
                order.append(k)
    hidden = set(s["design"]["hidden"])
    order = [k for k in order if k not in hidden and have.get(k, True)]
    own_page = [k for k in order if k in set(s["design"]["pages"])]
    return order, customs, own_page


def pages(s):
    """Every extra page this website has (besides the home page)."""
    order, customs, own_page = section_state(s)
    out = list(own_page)
    if booking_mode(s) == "popup":
        out.append("book")
    if str(s.get("privacy") or "").strip():
        out.append("privacy")
    return out


def page_title(s, key):
    titles = s["design"]["titles"] if isinstance(s["design"]["titles"], dict) else {}
    t = titles.get(key) if isinstance(titles.get(key), dict) else {}
    for c in s["sections"]:
        if c["id"] == key:
            return c["title"] or c["nav"] or "More"
    if key == "festive":
        return s["festive"]["title"] or "Festive"
    return t.get("title") or PAGE_TITLES.get(key, key.title())


def page_sections(s, page="", base="/"):
    """Which sections are on this page, in which order. Returns (sections, nav links, set of keys on the site)."""
    order, customs, own_page = section_state(s)
    titles = s["design"]["titles"] if isinstance(s["design"]["titles"], dict) else {}
    fest_label = s["festive"]["label"] or festival_label(s["festive"]["theme"])
    nav_names = {"menu": "Menu", "offers": "Offers", "about": "About", "gallery": "Gallery", "visit": "Visit"}

    def href(k):
        if k in own_page:
            return f"{base}{k}/"
        return f"#{k}" if not page else f"{base}#{k}"

    chosen = [k for k in s["design"].get("nav_show") or [] if isinstance(k, str)]
    nav = []
    for k in order:
        label = (titles.get(k) or {}).get("nav") if isinstance(titles.get(k), dict) else None
        if chosen:                                         # the admin picked exactly which sections are in the menu bar
            if k in chosen:
                name = fest_label if k == "festive" else (customs[k]["nav"] or customs[k]["title"]) if k in customs else \
                    label or nav_names.get(k) or PAGE_TITLES.get(k, k.title())
                nav.append((href(k), name, "fest-link" if k == "festive" else ""))
        elif k == "festive":
            nav.append((href(k), fest_label, "fest-link"))
        elif k in customs:
            if customs[k]["nav"]:
                nav.append((href(k), customs[k]["nav"], ""))
        elif label or k in nav_names:
            nav.append((href(k), label or nav_names[k], ""))

    if page:                                               # a page of its own: just that section
        sections = [{"key": page, "custom": customs.get(page), "teaser": False}] if page in own_page else []
    else:                                                  # home: everything, with a short teaser for menu/gallery pages
        sections = []
        for k in order:
            if k in own_page:
                if k in ("menu", "gallery"):
                    sections.append({"key": k, "custom": None, "teaser": True})
            else:
                sections.append({"key": k, "custom": customs.get(k), "teaser": False})
    return sections, nav, set(order)


def render_site(rid, s, preview=False, page="", base="/"):
    """Build one page of a restaurant's website. page "" = home; otherwise one of pages(s)."""
    def photo(p):
        p = str(p or "")
        if not p or re.match(r"https?://", p):
            return p
        return f"/media/{rid}/{os.path.basename(p)}"

    if page and page not in pages(s):
        return None
    env = _env.overlay()
    env.filters["photo"] = photo
    sections, nav_links, shown = page_sections(s, page, base)
    return env.get_template("site.html").render(
        s=s, rid=rid, d=design(s), sections=sections, nav_links=nav_links, shown=shown, tag_names=TAG_NAMES,
        hours_json=json.dumps(s["hours"]), schema=_schema(s), asset_v=ASSET_V,
        chat_on=bool(s["chat"]["ai"].get("website")), preview=preview,
        cookie_text=cookie_text(s), order=order_links(s), socials=social_links(s), credit=credit(s),
        mbar=mobile_bar(s), directions=directions_url(s),
        festive_on=festive_on(s), f=s["festive"], fest_style=festival_style(s["festive"]["theme"]),
        fest_label=s["festive"]["label"] or festival_label(s["festive"]["theme"]),
        page=page, base=base, page_title=page_title(s, page) if page else "", site_pages=pages(s),
        book_cfg=json.dumps({"rid": rid, "max": int(s["chat"]["max_party"] or 15), "days": int(s["chat"]["days_ahead"] or 60),
                             "phone": s["contact"]["phone"], "name": s["name"], "address": s["contact"]["address"],
                             "style": design(s)["booking_style"],
                             "privacy": f"{base}privacy/" if "privacy" in pages(s) else ""}).replace("</", "<\\/"),
        image_pos=IMAGE_POS,
    )


def by_domain(host):
    host = (host or "").split(":")[0].lower().removeprefix("www.")
    if not host:
        return None
    for rid in ids():
        try:
            d = _read(rpath(rid, "site.json")).get("domain", "")
        except (OSError, ValueError):
            continue
        d = re.sub(r"^https?://", "", str(d or "").strip().lower()).strip("/").removeprefix("www.")
        if d and d == host:
            return rid
    return None


# ---------------------------------------------------------------------
#  What the chat assistant knows (made from the same website data)
# ---------------------------------------------------------------------
def knowledge(s):
    out = [f"# {s['name']}", s["tagline"], s["intro"], s["about"], ""]
    c = s["contact"]
    out += ["## Contact", f"Address: {c['address']}", f"Phone: {c['phone']}", f"Email: {c['email']}", ""]
    out.append("## Opening hours")
    for h in s["hours"]:
        out.append(f"- {h[0]}: " + (f"{t12(h[1])} - {t12(h[2])}" if h[1] else "Closed"))
    if s["hours_note"]:
        out.append(s["hours_note"])
    if s["offers"]:
        out += ["", "## Offers"] + [f"- {o.get('title', '')}: {o.get('text', '')}" for o in s["offers"]]
    if festive_on(s):
        f = s["festive"]
        out += ["", f"## {f['label'] or festival_label(f['theme'])}: {f['title']}", f["dates"], f["text"]]
        out += [f"- {i.get('title', '')}" + (f" - {i['price']}" if i.get("price") else "") + (f" - {i['text']}" if i.get("text") else "")
                for i in f["items"]]
    for c in s["sections"]:
        if c["id"] not in s["design"]["hidden"] and (c["title"] or c["text"]):
            out += ["", f"## {c['title'] or c['nav'] or 'More'}", c["text"]]
            out += [f"- {i['title']}" + (f" - {i['price']}" if i["price"] else "") + (f" - {i['text']}" if i["text"] else "")
                    for i in c["items"]]
    if s["features"]:
        out += ["", "## Services"] + [f"- {f.get('title', '')}: {f.get('text', '')}" for f in s["features"]]
    if s["faq"]:
        out += ["", "## Questions and answers"] + [f"- {f.get('q', '')} {f.get('a', '')}" for f in s["faq"]]
    if s["chat"]["extra_info"]:
        out += ["", "## More information", s["chat"]["extra_info"]]
    if s["links"]["order_url"]:
        out += ["", f"Online ordering (our own, the best way to order): {s['links']['order_url']}"]
    apps = [f"{name}: {s['links'][k]}" for k, name in ORDER_PLATFORMS.items() if s["links"].get(k)]
    if apps:
        out += ["Also on: " + "; ".join(apps)]
    soc = [f"{name}: {url}" for _, name, url in social_links(s)]
    if soc:
        out += ["", "Social media: " + "; ".join(soc)]
    if s["menu"]:
        out += ["", "# Menu", s["menu_note"]]
        for cat in s["menu"]:
            out.append(f"\n## {cat['category']}" + (f" ({cat['note']})" if cat.get("note") else ""))
            for it in cat["items"]:
                line = f"- {it['name']} - {money(it['price'])}"
                if it.get("description"):
                    line += f" - {it['description']}"
                if it.get("tags"):
                    line += " [" + ", ".join(TAG_NAMES.get(t, t) for t in it["tags"]) + "]"
                if it.get("allergens"):
                    line += " [allergens: " + ", ".join(it["allergens"]) + "]"
                out.append(line)
    return "\n".join(x for x in out if x is not None)


def chat_cfg(rid):
    """Settings for the chat assistant. Content comes from the LIVE website; switches work straight away."""
    if not exists(rid):
        return None
    draft = load(rid)
    live = load(rid, published=True) or draft
    c = draft["chat"]
    return {
        "id": rid, "name": live["name"],
        "phone": live["contact"]["phone"], "address": live["contact"]["address"],
        "order_url": live["links"]["order_url"], "theme": live["theme"],
        "navira_slug": str(c["navira_slug"] or "").strip(),
        "max_party": int(c["max_party"] or 15), "days_ahead": int(c["days_ahead"] or 60),
        "assistant_name": c["assistant_name"], "greeting": c["greeting"],
        "quick_replies": c["quick_replies"], "allowed_websites": c["allowed_websites"] or [],
        "facebook_page_id": str(c["facebook_page_id"] or "").strip(),
        "instagram_id": str(c["instagram_id"] or "").strip(),
        "whatsapp_phone_id": str(c["whatsapp_phone_id"] or "").strip(),
        "monthly_limit": ai_limit(draft),
        "ai": c["ai"], "knowledge": knowledge(live) + "\n\n# More information (uploaded by the restaurant)\n" + knowledge_extra(rid),
    }


# ---------------------------------------------------------------------
#  AI knowledge: files, photos and links the chat assistant answers from
#  (kept in  <restaurant>/knowledge/ , used straight away, no publish needed)
# ---------------------------------------------------------------------
KNOWLEDGE_LIMIT = 60000        # characters of extra knowledge given to the assistant


def sources(rid):
    kdir = rpath(rid, "knowledge")
    out = []
    if os.path.isdir(kdir):
        for f in sorted(os.listdir(kdir)):
            if f.endswith(".json"):
                try:
                    d = _read(os.path.join(kdir, f))
                except (OSError, ValueError):
                    continue
                out.append({"id": f[:-5], "title": d.get("title", ""), "kind": d.get("kind", "file"),
                            "source": d.get("source", ""), "chars": len(d.get("text", "")),
                            "preview": d.get("text", "")[:160], "added": d.get("added", "")})
    return out


def add_source(rid, title, kind, source, text):
    text = str(text or "").strip()
    if not text:
        raise ValueError("Nothing readable was found in that.")
    kdir = rpath(rid, "knowledge")
    os.makedirs(kdir, exist_ok=True)
    sid = str(int(time.time() * 1000))
    while os.path.exists(os.path.join(kdir, sid + ".json")):
        sid = str(int(sid) + 1)
    _write(os.path.join(kdir, sid + ".json"), {
        "title": str(title or source or "Note")[:120], "kind": kind, "source": str(source or "")[:500],
        "text": text[:40000], "added": datetime.now().strftime("%d %b %Y")})
    return sid


def delete_source(rid, sid):
    if not re.fullmatch(r"\d{10,16}", str(sid)):
        raise ValueError("Bad id")
    path = rpath(rid, "knowledge", f"{sid}.json")
    if os.path.isfile(path):
        os.remove(path)


def knowledge_extra(rid):
    kdir = rpath(rid, "knowledge")
    parts, used = [], 0
    if os.path.isdir(kdir):
        for f in sorted(os.listdir(kdir)):
            if not f.endswith(".json"):
                continue
            try:
                d = _read(os.path.join(kdir, f))
            except (OSError, ValueError):
                continue
            text = d.get("text", "")[:KNOWLEDGE_LIMIT - used]
            if not text:
                break
            parts.append(f"\n## From: {d.get('title', 'uploaded information')}\n{text}")
            used += len(text)
    return "\n".join(parts)


# ---------------------------------------------------------------------
#  The builder conversation (so the AI remembers what you were doing)
# ---------------------------------------------------------------------
def conversation(rid):
    path = rpath(rid, "conversation.json")
    if os.path.isfile(path):
        try:
            return _read(path)
        except (OSError, ValueError):
            pass
    return []


def save_conversation(rid, turns):
    _write(rpath(rid, "conversation.json"), turns[-60:])


def delete_restaurant(rid):
    """Moves the restaurant to a 'trash' folder instead of destroying it."""
    with write_lock:
        trash = os.path.join(DATA_DIR, "trash")
        os.makedirs(trash, exist_ok=True)
        shutil.move(rpath(rid), os.path.join(trash, f"{rid}-{int(time.time())}"))


# ---------------------------------------------------------------------
#  MESSAGES: every customer conversation (website chat, Facebook, Instagram)
#  is kept in  <restaurant>/inbox/  so staff can read it, take over, and reply.
#  Kept for INBOX_DAYS days, then removed automatically.
# ---------------------------------------------------------------------
INBOX_DAYS = int(os.environ.get("INBOX_DAYS", "30"))


def _inbox_file(rid, channel, who):
    safe = re.sub(r"[^A-Za-z0-9_-]", "", str(who))[:80] or "unknown"
    if channel not in ("website", "facebook", "instagram", "whatsapp"):
        raise ValueError("Bad channel")
    return rpath(rid, "inbox", f"{channel}__{safe}.json")


def inbox_get(rid, channel, who):
    path = _inbox_file(rid, channel, who)
    if os.path.isfile(path):
        try:
            return _read(path)
        except (OSError, ValueError):
            pass
    return {"channel": channel, "who": str(who), "paused": False, "unread": 0, "updated": 0, "messages": []}


def inbox_add(rid, channel, who, role, text, **extra):
    """role: customer | ai | staff | note"""
    with write_lock:
        os.makedirs(rpath(rid, "inbox"), exist_ok=True)
        c = inbox_get(rid, channel, who)
        c["messages"].append({"role": role, "text": str(text)[:4000], "at": int(time.time()), **extra})
        c["messages"] = c["messages"][-200:]
        c["updated"] = int(time.time())
        if role == "customer":
            c["unread"] = c.get("unread", 0) + 1
        _write(_inbox_file(rid, channel, who), c)
    return c


def inbox_set(rid, channel, who, **fields):
    with write_lock:
        c = inbox_get(rid, channel, who)
        c.update(fields)
        os.makedirs(rpath(rid, "inbox"), exist_ok=True)
        _write(_inbox_file(rid, channel, who), c)
    return c


def inbox_list(rid):
    idir = rpath(rid, "inbox")
    out, cutoff = [], time.time() - INBOX_DAYS * 86400
    if os.path.isdir(idir):
        for f in os.listdir(idir):
            if not f.endswith(".json"):
                continue
            path = os.path.join(idir, f)
            try:
                c = _read(path)
            except (OSError, ValueError):
                continue
            if c.get("updated", 0) < cutoff:               # old conversations are removed
                os.remove(path)
                continue
            last = c["messages"][-1] if c.get("messages") else {"text": "", "role": ""}
            out.append({"rid": rid, "channel": c["channel"], "who": c["who"], "paused": bool(c.get("paused")),
                        "unread": c.get("unread", 0), "updated": c.get("updated", 0), "count": len(c.get("messages", [])),
                        "last": last["text"][:120], "last_role": last["role"], "name": c.get("name", "")})
    return sorted(out, key=lambda x: -x["updated"])


def inbox_delete(rid, channel, who):
    path = _inbox_file(rid, channel, who)
    if os.path.isfile(path):
        os.remove(path)


def log_booking(rid, entry):
    """A short record of each booking made through the website or the AI (the full booking lives in Navira)."""
    with write_lock:
        path = rpath(rid, "bookings.json")
        rows = _read(path) if os.path.isfile(path) else []
        rows.append({**entry, "at": int(time.time())})
        _write(path, rows[-500:])
    count(rid, "bookings")


def bookings(rid):
    path = rpath(rid, "bookings.json")
    try:
        return list(reversed(_read(path))) if os.path.isfile(path) else []
    except (OSError, ValueError):
        return []


# ---------------------------------------------------------------------
#  NUMBERS: visits, chats, AI replies and bookings per day, per restaurant.
#  No cookies and nothing personal is kept: only daily totals in  <restaurant>/stats.json
# ---------------------------------------------------------------------
STAT_KEYS = ("views", "visitors", "chats", "ai", "bookings")
_seen_today = {"day": "", "ids": set()}
_BOTS = re.compile(r"bot|crawl|spider|slurp|preview|monitor|curl|wget|python|headless|lighthouse|facebookexternalhit", re.I)


def today():
    return datetime.now(ZoneInfo("Europe/London")).strftime("%Y-%m-%d")


def count(rid, key, n=1):
    """Add to today's total. Never lets a counting problem break the website."""
    try:
        with write_lock:
            path = rpath(rid, "stats.json")
            data = _read(path) if os.path.isfile(path) else {}
            day = data.setdefault(today(), {})
            day[key] = int(day.get(key, 0)) + n
            for old in sorted(data)[:-400]:                 # keep about 13 months
                del data[old]
            _write(path, data)
    except (OSError, ValueError, TypeError) as e:
        print("[STATS]", e)


def count_visit(rid, ip, agent):
    """One page was opened. 'visitors' counts each person once a day (a scrambled code kept only in memory)."""
    if not agent or _BOTS.search(agent):
        return
    day = today()
    code = hashlib.sha256(f"{day}|{rid}|{ip}|{agent}|{_SALT}".encode()).hexdigest()[:16]
    with write_lock:
        if _seen_today["day"] != day:
            _seen_today.update(day=day, ids=set())
        new = code not in _seen_today["ids"]
        _seen_today["ids"].add(code)
    count(rid, "views")
    if new:
        count(rid, "visitors")


def stats(rid, days=30):
    """Totals and a row per day for the last `days` days (newest first)."""
    path = rpath(rid, "stats.json")
    try:
        data = _read(path) if os.path.isfile(path) else {}
    except (OSError, ValueError):
        data = {}
    now = datetime.now(ZoneInfo("Europe/London"))
    rows = []
    for i in range(days):
        d = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        rows.append({"day": d, **{k: int((data.get(d) or {}).get(k, 0)) for k in STAT_KEYS}})
    month = now.strftime("%Y-%m")
    return {"days": rows, "total": {k: sum(r[k] for r in rows) for k in STAT_KEYS},
            "ai_this_month": sum(int(v.get("ai", 0)) for d, v in data.items() if d.startswith(month))}


def ai_limit(s):
    """Most AI replies allowed in a month for this restaurant (0 = no limit)."""
    try:
        own = int(s["chat"].get("monthly_limit") or 0)
    except (TypeError, ValueError):
        own = 0
    return own if own > 0 else int(os.environ.get("AI_MONTHLY_LIMIT", "0") or 0)


def ai_used(rid):
    return stats(rid, 1)["ai_this_month"]


COOKIE_DEFAULT = ("This website only stores what it needs to work, for example to remember your chat. "
                  "It does not use advertising or tracking cookies.")


def cookie_text(s):
    c = s.get("cookies") or {}
    return (str(c.get("text") or "").strip() or COOKIE_DEFAULT) if c.get("enabled") else ""


# ---------------------------------------------------------------------
#  COPY, EXPORT and IMPORT a restaurant
# ---------------------------------------------------------------------
PRIVATE_PARTS = ("inbox", "bookings.json", "stats.json", "conversation.json", "offline.txt")    # customer data: never copied


def _clean_copy(s, name=None):
    """A copied or imported restaurant must not answer for, or take bookings as, the original."""
    if name:
        s["name"] = name
    s["domain"] = ""
    for k in ("navira_slug", "facebook_page_id", "instagram_id", "whatsapp_phone_id"):
        s["chat"][k] = ""
    return s


def duplicate(rid, new_id, name):
    if not valid_id(new_id):
        raise ValueError("The short name can only use small letters, numbers and dashes (2 to 40 characters).")
    if exists(new_id):
        raise ValueError("A restaurant with that short name already exists.")
    with write_lock:
        os.makedirs(rpath(new_id))
        for part in ("photos", "knowledge"):
            if os.path.isdir(rpath(rid, part)):
                shutil.copytree(rpath(rid, part), rpath(new_id, part))
        os.makedirs(rpath(new_id, "photos"), exist_ok=True)
        _write(rpath(new_id, "site.json"), _clean_copy(load(rid), name))


def export_zip(rid):
    """One restaurant as a zip (website, photos, AI knowledge, history). Customer messages are left out."""
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        root = rpath(rid)
        for folder, dirs, files in os.walk(root):
            rel = os.path.relpath(folder, root)
            if rel.split(os.sep)[0] in PRIVATE_PARTS:
                continue
            for f in files:
                if rel == "." and f in PRIVATE_PARTS or f.endswith(".tmp"):
                    continue
                z.write(os.path.join(folder, f), os.path.normpath(os.path.join(rel, f)).replace(os.sep, "/"))
    return buf.getvalue()


def import_zip(raw, new_id, name=""):
    """Make a new restaurant from an exported zip. Only known, safe file names are taken out of the zip."""
    import io
    import zipfile
    if not valid_id(new_id):
        raise ValueError("The short name can only use small letters, numbers and dashes (2 to 40 characters).")
    if exists(new_id):
        raise ValueError("A restaurant with that short name already exists.")
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise ValueError("That file is not a zip exported from Navira Hub.")
    names = [n for n in z.namelist() if not n.endswith("/")]
    prefix = ""
    if "site.json" not in names:                            # zipped by hand with a folder around it
        tops = {n.split("/")[0] for n in names}
        if len(tops) == 1 and f"{next(iter(tops))}/site.json" in names:
            prefix = next(iter(tops)) + "/"
        else:
            raise ValueError("That zip has no site.json in it, so it is not a restaurant export.")
    ok = re.compile(r"(site\.json|published\.json|(photos|knowledge|versions)/[A-Za-z0-9][A-Za-z0-9._ -]{0,120})")
    picked = [(n, n[len(prefix):]) for n in names if n.startswith(prefix) and ok.fullmatch(n[len(prefix):])]
    if sum(z.getinfo(n).file_size for n, _ in picked) > 300 * 1024 * 1024 or len(picked) > 3000:
        raise ValueError("That zip is too big.")
    try:
        site = merge(json.loads(z.read(prefix + "site.json")))
    except (ValueError, KeyError):
        raise ValueError("The site.json in that zip cannot be read.")
    with write_lock:
        os.makedirs(rpath(new_id, "photos"))
        try:
            for n, rel in picked:
                if rel in ("site.json", "published.json"):
                    continue
                dest = rpath(new_id, *rel.split("/"))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "wb") as out:
                    out.write(z.read(n))
            _write(rpath(new_id, "site.json"), _clean_copy(site, name or None))
        except Exception:
            shutil.rmtree(rpath(new_id), ignore_errors=True)
            raise


# ---------------------------------------------------------------------
#  BACKUPS: the whole data folder as one zip, once a day, in  DATA_DIR/backups
# ---------------------------------------------------------------------
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
BACKUP_KEEP = max(1, int(os.environ.get("BACKUP_KEEP", "7") or 7))


def backups():
    try:
        names = sorted((n for n in os.listdir(BACKUP_DIR) if re.fullmatch(r"navira-[0-9-]+\.zip", n)), reverse=True)
    except OSError:
        return []
    return [{"name": n, "mb": round(os.path.getsize(os.path.join(BACKUP_DIR, n)) / 1048576, 1),
             "when": datetime.fromtimestamp(os.path.getmtime(os.path.join(BACKUP_DIR, n)), ZoneInfo("Europe/London")).strftime("%d %b %Y, %H:%M")}
            for n in names]


def backup_now(stamp=None):
    """Zip everything except old backups and the trash. Returns the file name."""
    import zipfile
    os.makedirs(BACKUP_DIR, exist_ok=True)
    name = f"navira-{stamp or datetime.now(ZoneInfo('Europe/London')).strftime('%Y-%m-%d-%H%M')}.zip"
    tmp = os.path.join(BACKUP_DIR, name + ".part")
    with write_lock:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            for folder, dirs, files in os.walk(DATA_DIR):
                dirs[:] = [d for d in dirs if os.path.join(folder, d) not in (BACKUP_DIR, os.path.join(DATA_DIR, "trash"))]
                for f in files:
                    if not f.endswith((".tmp", ".part")):
                        full = os.path.join(folder, f)
                        z.write(full, os.path.relpath(full, DATA_DIR))
        os.replace(tmp, os.path.join(BACKUP_DIR, name))
    for old in backups()[BACKUP_KEEP:]:
        try:
            os.remove(os.path.join(BACKUP_DIR, old["name"]))
        except OSError:
            pass
    return name


def _backup_loop():
    """Once an hour: if there is no backup from today yet, make one."""
    while True:
        time.sleep(3600)
        try:
            day = today()
            if not any(b["name"].startswith(f"navira-{day}") for b in backups()):
                print("[BACKUP] saved", backup_now())
        except Exception as e:
            print("[BACKUP ERROR]", type(e).__name__, e)


def start_backups():
    if os.environ.get("AUTO_BACKUP", "1") != "0":
        threading.Thread(target=_backup_loop, daemon=True).start()
