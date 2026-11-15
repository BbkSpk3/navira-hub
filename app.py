# =====================================================================
#  NAVIRA HUB - everything in one place
#
#     /admin            dashboard: create + edit restaurant websites, AI editor,
#                       photos, preview, publish, AI on/off switches
#     /s/<id>/          each restaurant's live website
#     /widget.js        chat widget for any other website
#     /webhooks/meta    Facebook Messenger + Instagram messages + WhatsApp
#
#  Run on your laptop (Windows):
#     pip install -r requirements.txt
#     set ANTHROPIC_API_KEY=your-key
#     set ADMIN_PASSWORD=choose-a-password
#     python app.py
#     open http://127.0.0.1:5000/admin
#
#  Files:  core.py  = data + website      chat.py  = AI chat + booking + channels
#          admin.py = dashboard + AI editor
# =====================================================================

import hashlib
import os
import sys
from datetime import timedelta

from flask import Flask, abort, redirect, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

for _stream in (sys.stdout, sys.stderr):                    # never crash on a character the console can't show
    try:
        _stream.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

import core

core.init()
core.start_backups()

import admin   # noqa: E402  (after core.init so the data folder exists)
import chat    # noqa: E402

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1)            # keeps https in links when hosted
app.secret_key = os.environ.get("SECRET_KEY") or hashlib.sha256(
    ("navira-hub:" + (admin.ADMIN_PASSWORD or "not-set")).encode()).hexdigest()
app.config.update(
    MAX_CONTENT_LENGTH=80 * 1024 * 1024,
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.environ.get("RENDER")),   # https-only cookie when hosted on Render
)
app.json.sort_keys = False                                  # keep lists (templates, options) in their written order
app.register_blueprint(chat.bp)
app.register_blueprint(admin.bp)


OFFLINE_PAGE = ("<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                "<meta name='robots' content='noindex'><title>Not available</title></head>"
                "<body style='font-family:system-ui,sans-serif;text-align:center;padding:18vh 20px;color:#222'>"
                "<h1 style='font-size:26px'>This website is not available right now</h1><p>Please check back later.</p></body></html>")


def live_site(rid, page="", base="/"):
    s = core.load(rid, published=True)
    if s is None:
        abort(404)
    if core.is_offline(rid):                     # switched off in the admin
        resp = app.make_response((OFFLINE_PAGE, 404))
        resp.headers["Cache-Control"] = "no-store"
        return resp
    html = core.render_site(rid, s, page=page, base=base)
    if html is None:
        abort(404)
    core.count_visit(rid, request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip(),
                     request.headers.get("User-Agent", ""))
    resp = app.make_response(html)
    resp.headers["Cache-Control"] = "public, max-age=60"
    return resp


def sitemap(rid, root):
    s = core.load(rid, published=True)
    if s is None or core.is_offline(rid):
        abort(404)
    urls = [root] + [f"{root}{p}/" for p in core.pages(s)]
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + \
          "".join(f"  <url><loc>{u}</loc></url>\n" for u in urls) + "</urlset>\n"
    return app.response_class(xml, mimetype="application/xml")


@app.route("/")
def home():
    rid = core.by_domain(request.host)          # a restaurant's own domain shows its website
    if rid:
        return live_site(rid)
    return redirect("/admin")


@app.route("/<page>/")
def domain_page(page):
    """menu/, gallery/, book/ ... on a restaurant's own domain."""
    rid = core.by_domain(request.host)
    if not rid:
        abort(404)
    return live_site(rid, page, "/")


@app.route("/sitemap.xml")
def domain_sitemap():
    rid = core.by_domain(request.host)
    if not rid:
        abort(404)
    return sitemap(rid, request.host_url)


@app.route("/robots.txt")
def robots():
    rid = core.by_domain(request.host)
    body = f"User-agent: *\nAllow: /\nSitemap: {request.host_url}sitemap.xml\n" if rid else "User-agent: *\nDisallow: /admin\n"
    return app.response_class(body, mimetype="text/plain")


@app.route("/s/<rid>")
def site_no_slash(rid):
    return redirect(f"/s/{rid}/")


@app.route("/s/<rid>/")
def site(rid):
    if not core.exists(rid):
        abort(404)
    return live_site(rid, "", f"/s/{rid}/")


@app.route("/s/<rid>/sitemap.xml")
def site_sitemap(rid):
    if not core.exists(rid):
        abort(404)
    return sitemap(rid, f"{request.host_url}s/{rid}/")


@app.route("/s/<rid>/<page>/")
def site_page(rid, page):
    if not core.exists(rid):
        abort(404)
    return live_site(rid, page, f"/s/{rid}/")


@app.route("/site-assets/<name>")
def site_assets(name):
    if name not in ("style.css", "site.js"):
        abort(404)
    resp = send_from_directory(core.SITE_TEMPLATE_DIR, name)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@app.route("/media/<rid>/<name>")
def media(rid, name):
    if not core.exists(rid) or name not in core.photos(rid):
        abort(404)
    resp = send_from_directory(core.rpath(rid, "photos"), name)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@app.route("/health")
def health():
    return {"ok": True, "restaurants": len(core.ids())}


@app.errorhandler(404)
def not_found(_):
    return "<h1>Page not found</h1>", 404


@app.errorhandler(413)
def too_big(_):
    return {"ok": False, "error": "That upload is too big."}, 413


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Open http://127.0.0.1:{port}/admin in your browser")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
