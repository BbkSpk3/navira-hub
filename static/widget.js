/* Navira Chat widget
   Add to any website, before </body>:
   <script src="https://YOUR-SERVER/widget.js" data-restaurant="RESTAURANT-ID" defer></script>
   Optional: data-bottom="90" (move the button up, in pixels, e.g. above a mobile bar) */
(function () {
  "use strict";
  if (window.__naviraChat) return;
  window.__naviraChat = true;

  const me = document.currentScript || document.querySelector('script[data-restaurant][src*="widget.js"]');
  if (!me) return;
  const RID = me.getAttribute("data-restaurant");
  const SERVER = new URL(me.src, location.href).origin;
  const EXTRA_BOTTOM = me.getAttribute("data-bottom");

  function start(cfg) {
    if (cfg.enabled === false) return;   // AI chat is switched off for this restaurant
    const color = cfg.theme.color || "#25425c";
    const accent = cfg.theme.accent || "#c49a3c";
    const on = cfg.theme.on || "#fff";        // text colour that is readable on the main colour
    const bottom = Number(EXTRA_BOTTOM || cfg.mobile_bottom_offset || 18);
    const phone = cfg.phone || "";

    /* Shadow DOM: the restaurant's website styles can't break the chat, and the chat can't break the website */
    const host = document.createElement("div");
    host.id = "navira-chat";
    host.style.cssText = "position:fixed;z-index:2147483000;right:0;bottom:0;width:0;height:0";
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });

    root.innerHTML = `<style>
      :host{all:initial}
      *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
      .launch{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));display:flex;align-items:center;gap:10px;height:58px;
        padding:0 20px 0 16px;border:0;border-radius:999px;cursor:pointer;background:${color};color:${on};font-size:15px;font-weight:600;
        box-shadow:0 10px 30px rgba(0,0,0,.28),inset 0 0 0 1px ${accent}88;transition:transform .25s,opacity .25s}
      .launch:hover{transform:translateY(-2px)}
      .launch .dot{position:absolute;top:8px;right:10px;width:10px;height:10px;border-radius:50%;background:${accent};box-shadow:0 0 0 2px ${color}}
      .launch.open{opacity:0;pointer-events:none;transform:scale(.8)}
      .panel{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));width:min(390px,calc(100vw - 36px));
        height:min(620px,calc(100vh - 110px));display:flex;flex-direction:column;background:#fff;border-radius:18px;overflow:hidden;
        box-shadow:0 24px 70px rgba(0,0,0,.3);color:#1c2126;opacity:0;transform:translateY(16px) scale(.97);
        transform-origin:bottom right;pointer-events:none;transition:opacity .25s,transform .25s}
      .panel.open{opacity:1;transform:none;pointer-events:auto}
      .head{display:flex;align-items:center;gap:12px;padding:16px;background:${color};color:${on};border-bottom:2px solid ${accent}}
      .av{width:40px;height:40px;border-radius:50%;flex:none;display:grid;place-items:center;background:rgba(255,255,255,.12);
        border:1px solid ${accent};color:${on};font-weight:700;font-size:17px}
      .head h3{margin:0;font-size:16px;font-weight:600;line-height:1.2}
      .head p{margin:3px 0 0;font-size:12px;opacity:.8;display:flex;align-items:center;gap:6px}
      .head p i{width:7px;height:7px;border-radius:50%;background:#5fd38d}
      .x{margin-left:auto;width:36px;height:36px;border:0;border-radius:50%;background:rgba(128,128,128,.25);color:${on};cursor:pointer;display:grid;place-items:center}
      .body{flex:1;overflow-y:auto;padding:18px 14px 8px;background:#f6f4ef}
      .msg{max-width:84%;margin:0 0 10px;padding:10px 14px;border-radius:16px;font-size:14.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
      .bot{background:#fff;border:1px solid #e3ded3;border-bottom-left-radius:4px}
      .you{margin-left:auto;background:${color};color:${on};border-bottom-right-radius:4px}
      .msg b{font-weight:600}.msg a{color:inherit}
      .typing{display:inline-flex;gap:4px;padding:14px 16px}
      .typing span{width:7px;height:7px;border-radius:50%;background:#8a8170;opacity:.4;animation:b 1.2s infinite}
      .typing span:nth-child(2){animation-delay:.15s}.typing span:nth-child(3){animation-delay:.3s}
      @keyframes b{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}
      .chips{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 12px}
      .chip{border:1px solid ${accent};background:#fff;color:${on === "#ffffff" ? color : "#1c2126"};border-radius:999px;padding:8px 13px;font-size:13px;font-weight:500;cursor:pointer}
      .chip:hover{background:${color};color:${on};border-color:${color}}
      .chip:disabled{opacity:.45;cursor:default;background:#fff;color:#1c2126}
      form{display:flex;gap:8px;padding:12px;border-top:1px solid #e3ded3;background:#fff;margin:0}
      input{flex:1;min-width:0;height:46px;padding:0 14px;border:1px solid #ddd5c5;border-radius:12px;font-size:16px;color:inherit;background:#fff}
      input:focus{outline:2px solid ${accent};outline-offset:-1px;border-color:transparent}
      .send{width:46px;height:46px;flex:none;border:0;border-radius:12px;background:${color};color:${on};cursor:pointer;display:grid;place-items:center}
      .send:disabled{opacity:.5}
      .foot{padding:0 12px 10px;background:#fff;font-size:11px;color:#6b6f75;text-align:center}
      @media (max-width:760px){
        .launch{bottom:calc(${bottom}px + env(safe-area-inset-bottom,0px));height:54px;padding:0 16px}
        .launch .lbl{display:none}
        .panel{right:0;left:0;bottom:0;width:100%;height:100%;height:100dvh;border-radius:0}
      }
      @media (prefers-reduced-motion:reduce){.launch,.panel{transition:none}}
    </style>
    <button class="launch" type="button" aria-label="Chat with us">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" stroke-width="2.6"/></svg>
      <span class="lbl">${cfg.booking ? "Chat &amp; book" : "Chat with us"}</span><span class="dot"></span>
    </button>
    <div class="panel" role="dialog" aria-label="Chat" aria-hidden="true">
      <div class="head">
        <div class="av" aria-hidden="true"></div>
        <div><h3></h3><p><i></i>${cfg.booking ? "Bookings, menu &amp; opening times" : "Menu, opening times &amp; more"}</p></div>
        <button class="x" type="button" aria-label="Close chat"><svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6"><path d="M2 2l12 12M14 2L2 14"/></svg></button>
      </div>
      <div class="body" aria-live="polite"></div>
      <form><input type="text" placeholder="Type a message…" autocomplete="off" maxlength="500" aria-label="Your message">
        <button class="send" type="submit" aria-label="Send"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>
      <div class="foot"></div>
    </div>`;

    const $ = (s) => root.querySelector(s);
    $(".av").textContent = (cfg.name || "?").trim()[0].toUpperCase();
    $(".head h3").textContent = cfg.assistant_name;
    $(".foot").textContent = "AI assistant" + (phone ? " · for urgent help call " + phone : "");
    const launch = $(".launch"), panel = $(".panel"), body = $(".body"), form = $("form"), input = $("input"), sendBtn = $(".send");

    let chatId;
    try { chatId = sessionStorage.getItem("navira_chat_" + RID); } catch (_) {}
    if (!chatId) { chatId = Math.random().toString(36).slice(2) + Date.now().toString(36); try { sessionStorage.setItem("navira_chat_" + RID, chatId); } catch (_) {} }

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    function fmt(t) {
      let h = esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
      h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      h = h.replace(/(^|[\s(])(0\d{3,4}\s?\d{3}\s?\d{3,4})/g, (m, a, n) => a + '<a href="tel:+44' + n.replace(/\s/g, "").slice(1) + '">' + n + "</a>");
      return h;
    }
    function add(text, who) {
      const d = document.createElement("div");
      d.className = "msg " + who;
      d.innerHTML = fmt(text);
      body.appendChild(d); body.scrollTop = body.scrollHeight;
      return d;
    }
    function chips(list) {
      if (!list || !list.length) return;
      const w = document.createElement("div"); w.className = "chips";
      list.forEach((c) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "chip";
        b.textContent = c.label || c; b.dataset.send = c.send || c.label || c;
        w.appendChild(b);
      });
      body.appendChild(w); body.scrollTop = body.scrollHeight;
    }

    /* a member of staff can answer from the restaurant's Messages screen: check for their replies */
    let seen = 0, told = false, timer = null;
    async function check() {
      if (!panel.classList.contains("open") || document.hidden) return;
      try {
        const r = await fetch(SERVER + "/api/chat/updates?restaurant=" + encodeURIComponent(RID) + "&chat_id=" + encodeURIComponent(chatId) + "&after=" + seen);
        const j = await r.json();
        (j.messages || []).forEach((m) => { add(m.text, "bot"); if (m.at > seen) seen = m.at; });
      } catch (_) {}
    }
    function watch() { if (!timer) timer = setInterval(check, 8000); }

    let busy = false;
    async function send(text) {
      text = String(text || "").trim();
      if (!text || busy) return;
      busy = true; sendBtn.disabled = true;
      body.querySelectorAll(".chip").forEach((b) => (b.disabled = true));
      add(text, "you"); input.value = "";
      const t = add("", "bot typing"); t.innerHTML = "<span></span><span></span><span></span>";
      try {
        const r = await fetch(SERVER + "/api/chat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurant: RID, chat_id: chatId, message: text }),
        });
        const data = await r.json();
        t.remove();
        if (data.waiting) { if (!told) { told = true; add("Thanks! A member of our team will reply here shortly.", "bot"); } }
        else { told = false; add(data.reply || "Sorry, something went wrong.", "bot"); chips(data.chips); }
        if (data.now && !seen) seen = data.now;
        watch();
      } catch (e) {
        t.remove();
        add("Sorry, I can't connect right now." + (phone ? " Please call us on " + phone + "." : ""), "bot");
      } finally {
        busy = false; sendBtn.disabled = false;
        input.focus({ preventScroll: true });
      }
    }
    form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
    body.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b && !b.disabled) send(b.dataset.send); });

    let started = false, oldOverflow = "";
    const mobile = () => matchMedia("(max-width:760px)").matches;
    function open() {
      panel.classList.add("open"); panel.setAttribute("aria-hidden", "false");
      launch.classList.add("open");
      const dot = $(".dot"); if (dot) dot.remove();
      if (mobile()) { oldOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden"; }
      if (!started) { started = true; add(cfg.greeting, "bot"); chips(cfg.quick_replies); }
      setTimeout(() => input.focus({ preventScroll: true }), 250);
    }
    function close() {
      panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true");
      launch.classList.remove("open");
      document.documentElement.style.overflow = oldOverflow;
      launch.focus({ preventScroll: true });
    }
    launch.addEventListener("click", open);
    $(".x").addEventListener("click", close);
    root.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    window.NaviraChat = { open, close, send };
  }

  function boot() {
    fetch(SERVER + "/api/config/" + encodeURIComponent(RID))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(start)
      .catch((e) => console.warn("Navira chat: could not load settings for '" + RID + "'", e));
  }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot);
})();
