/* Navira Hub - Messages & channels: website chat, Facebook and Instagram in one place */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v; else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v; else if (k === "checked") el.checked = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  function toast(t, bad) { const el = $("#toast"); el.textContent = t; el.className = "toast show" + (bad ? " bad" : ""); clearTimeout(el._t); el._t = setTimeout(() => (el.className = "toast"), bad ? 6000 : 2600); }
  async function api(path, body) {
    const o = body ? { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF }, body: JSON.stringify(body) } : {};
    let r, j;
    try { r = await fetch("/admin/messages" + path, o); j = await r.json(); } catch (e) { throw new Error("Could not reach the server."); }
    if (r.status === 401) { location.href = "/admin/login"; throw new Error("Please log in again."); }
    if (!j.ok) throw new Error(j.error || "Something went wrong.");
    return j;
  }

  const CH = { website: "Website chat", facebook: "Facebook", instagram: "Instagram", whatsapp: "WhatsApp" };
  let D = null, tab = "inbox", fRest = "", fChan = "", open = null, thread = null, draft = "";
  const key = (c) => c.rid + "|" + c.channel + "|" + c.who;
  const rname = (rid) => (D.restaurants.find((r) => r.id === rid) || {}).name || rid;
  const who = (c) => c.name || (c.channel === "website" ? "Website visitor " : CH[c.channel] + " customer ") + "…" + String(c.who).slice(-4);
  function ago(t) {
    const s = Math.max(0, D.now - t);
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  const clock = (t) => new Date(t * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  /* ---------- Conversations ---------- */
  function inbox() {
    const list = D.conversations.filter((c) => (!fRest || c.rid === fRest) && (!fChan || c.channel === fChan));
    const filters = h("div", { class: "msg-filters" },
      h("select", { "aria-label": "Restaurant", onchange: (e) => { fRest = e.target.value; render(); } }, h("option", { value: "", text: "All restaurants" }), D.restaurants.map((r) => h("option", { value: r.id, text: r.name, selected: r.id === fRest }))),
      h("select", { "aria-label": "Channel", onchange: (e) => { fChan = e.target.value; render(); } }, h("option", { value: "", text: "All channels" }), Object.entries(CH).map(([k, v]) => h("option", { value: k, text: v, selected: k === fChan }))));
    const items = list.length ? list.map((c) => h("button", { type: "button", class: "conv" + (open && key(open) === key(c) ? " on" : "") + (c.unread ? " unread" : ""), onclick: () => openThread(c) },
      h("span", { class: "ch ch-" + c.channel, text: CH[c.channel] }),
      h("strong", {}, who(c), c.paused ? h("em", { class: "pill amber", text: "Staff" }) : null, c.unread ? h("em", { class: "badge", text: String(c.unread) }) : null),
      h("small", { text: rname(c.rid) + " · " + ago(c.updated) }),
      h("span", { class: "last", text: (c.last_role === "customer" ? "" : c.last_role === "staff" ? "You: " : c.last_role === "ai" ? "AI: " : "") + c.last })))
      : [h("p", { class: "muted pad", text: "No conversations yet. When customers write on the website chat, Facebook, Instagram or WhatsApp, they appear here." })];
    return h("div", { class: "msg-grid" }, h("aside", { class: "msg-list" }, filters, h("div", { class: "convs" }, items)), h("section", { class: "msg-thread", id: "thread" }, threadView()));
  }
  function threadView() {
    if (!open || !thread) return [h("div", { class: "empty-thread" }, h("h2", { text: "Choose a conversation" }), h("p", { class: "muted", text: "The AI answers customers by itself. Open a conversation to read it, take it over, or reply yourself." }))];
    const c = thread;
    const log = h("div", { class: "log", id: "log" }, c.messages.map((m) => m.role === "note"
      ? h("p", { class: "note", text: m.text + " · " + clock(m.at) })
      : h("div", { class: "bubble " + (m.role === "customer" ? "ai" : "me") + (m.role === "staff" ? " staff" : "") },
        h("small", { class: "who", text: (m.role === "customer" ? "Customer" : m.role === "staff" ? "You (staff)" : "AI assistant") + " · " + clock(m.at) }), m.text.replace(/\*\*/g, ""))));
    const box = h("textarea", { rows: 2, placeholder: open.channel === "website" ? "Reply… (appears in the customer's chat window while it is open)" : "Reply on " + CH[open.channel] + "…", "aria-label": "Your reply", oninput: (e) => (draft = e.target.value), value: draft });
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    return [
      h("div", { class: "thread-head" },
        h("div", {}, h("strong", { text: who(open) }), h("small", { class: "muted", text: " " + CH[open.channel] + " · " + rname(open.rid) })),
        h("span", { class: "grow" }),
        c.paused ? h("button", { class: "btn sm", type: "button", onclick: () => pause(false) }, "Hand back to AI") : h("button", { class: "btn sm", type: "button", onclick: () => pause(true) }, "Take over from AI"),
        h("button", { class: "btn sm quiet danger", type: "button", onclick: del }, "Delete")),
      h("p", { class: "state " + (c.paused ? "amber" : "green"), text: c.paused ? "You have taken over. The AI will not answer this customer until you hand it back." : "The AI is answering this customer." }),
      log,
      h("div", { class: "composer" }, box, h("button", { class: "btn primary", type: "button", onclick: send }, "Send")),
      h("p", { class: "hint", text: open.channel === "website" ? "Sending a reply takes the conversation over from the AI. Website visitors only see it while their chat window is open." : "Sending a reply takes the conversation over from the AI. Meta only allows replies within 24 hours of the customer's last message." }),
    ];
  }
  async function openThread(c) {
    open = c; draft = "";
    try { thread = (await api(`/thread?rid=${encodeURIComponent(c.rid)}&channel=${c.channel}&who=${encodeURIComponent(c.who)}`)).conversation; c.unread = 0; }
    catch (e) { toast(e.message, true); thread = null; }
    render(); const l = $("#log"); if (l) l.scrollTop = l.scrollHeight;
    if (window.innerWidth <= 860) { const t = $("#thread"); if (t) t.scrollIntoView({ behavior: "smooth" }); }
  }
  const args = () => ({ rid: open.rid, channel: open.channel, who: open.who });
  async function send() {
    if (!draft.trim()) return;
    try { thread = (await api("/reply", Object.assign(args(), { text: draft }))).conversation; draft = ""; await load(true); const l = $("#log"); if (l) l.scrollTop = l.scrollHeight; }
    catch (e) { toast(e.message, true); }
  }
  async function pause(on) {
    try { thread = (await api("/pause", Object.assign(args(), { paused: on }))).conversation; await load(true); toast(on ? "You have taken over." : "Handed back to the AI."); }
    catch (e) { toast(e.message, true); }
  }
  async function del() {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    try { await api("/delete", args()); open = null; thread = null; await load(true); } catch (e) { toast(e.message, true); }
  }

  /* ---------- Bookings ---------- */
  function bookings() {
    const rows = D.bookings.filter((b) => !fRest || b.rid === fRest);
    return h("div", { class: "page" },
      h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "Bookings from the website and the AI" }), h("p", { class: "muted", text: "A quick list for checking. The full bookings, changes and cancellations are in your Navira booking system." }))),
      rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "tbl" },
        h("thead", {}, h("tr", {}, ["Made", "Restaurant", "Name", "Date", "Time", "Guests", "Reference", "Came from"].map((t) => h("th", { text: t })))),
        h("tbody", {}, rows.map((b) => h("tr", {}, [clock(b.at), b.restaurant, b.name, b.date, b.time, String(b.party), b.ref || "-", b.via].map((t) => h("td", { text: t })))))))
        : h("div", { class: "empty-state" }, h("h2", { text: "No bookings yet" }), h("p", { class: "muted", text: "Bookings made in the website form or by the AI assistant will be listed here." })));
  }

  /* ---------- Channels ---------- */
  function channels() {
    const sw = (r, ch) => {
      const box = h("input", { type: "checkbox", checked: !!r.ai[ch], "aria-label": `AI on ${CH[ch]} for ${r.name}`, onchange: async () => {
        try { const res = await fetch(`/admin/r/${r.id}/switch`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF }, body: JSON.stringify({ channel: ch, on: box.checked }) }); const j = await res.json(); if (!j.ok) throw new Error(j.error); r.ai[ch] = box.checked; toast(`AI turned ${box.checked ? "on" : "off"}: ${r.name}, ${CH[ch]}`); }
        catch (e) { box.checked = !box.checked; toast(e.message || "Could not change it", true); }
      } });
      const ok = /^(Ready|Connected)$/.test(r.status[ch]);
      return h("td", {}, h("label", { class: "switch" }, box, h("span", { class: "track" }), h("span", { class: "lbl", text: "AI" })), h("small", { class: "st " + (ok ? "ok" : "no"), text: r.status[ch] }));
    };
    return h("div", { class: "page" },
      h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "Channels" }), h("p", { class: "muted", text: "Turn the AI on or off for each restaurant and channel, and see what still needs setting up." }))),
      h("div", { class: "table-wrap" }, h("table", { class: "tbl" },
        h("thead", {}, h("tr", {}, ["Restaurant", "Website chat", "Facebook", "Instagram", "WhatsApp", "Table booking", ""].map((t) => h("th", { text: t })))),
        h("tbody", {}, D.restaurants.map((r) => h("tr", {}, h("th", { text: r.name }), sw(r, "website"), sw(r, "facebook"), sw(r, "instagram"), sw(r, "whatsapp"),
          h("td", {}, h("small", { class: "st " + (r.booking ? "ok" : "no"), text: r.booking ? "Navira connected" : "No Navira slug" })),
          h("td", {}, h("a", { class: "btn sm", href: `/admin/r/${r.id}` }, "Settings"))))))),
      h("div", { class: "group", style: "margin-top:20px" }, h("h3", { text: "What the words mean" }),
        h("ul", { class: "hint" },
          h("li", { text: "Meta app not connected: add META_APP_SECRET and META_VERIFY_TOKEN to the server's Environment Variables (HOW-TO.txt, Part 4)." }),
          h("li", { text: "No account ID yet: open the restaurant → Chat & channels and type the Facebook Page ID or Instagram account ID." }),
          h("li", { text: "Page token missing: add the restaurant's Page token to the Environment Variables. The name to use is shown in Chat & channels." }),
          h("li", { text: "No Navira slug: open the restaurant → Chat & channels → Navira booking slug. Without it, the website shows the booking link instead of the form, and the AI cannot book." })),
        h("p", { class: "hint", text: "Webhook address for Meta: " + D.webhook_url }),
        h("p", { class: "hint", text: `Conversations are kept for ${D.keep_days} days, then removed automatically.` })));
  }

  function render() {
    $("#mTabs").replaceChildren(...[["inbox", "Conversations" + (D.unread ? ` (${D.unread})` : "")], ["bookings", "Bookings"], ["channels", "Channels"]].map(([id, label]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(id === tab), onclick: () => { tab = id; render(); } }, label)));
    const keep = document.activeElement && document.activeElement.tagName === "TEXTAREA";
    const l = $("#log"), y = l ? l.scrollTop : null;
    $("#mMain").replaceChildren(tab === "inbox" ? inbox() : tab === "bookings" ? bookings() : channels());
    const l2 = $("#log"); if (l2 && y != null) l2.scrollTop = y;
    if (keep) { const b = document.querySelector(".composer textarea"); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }
  }
  async function load(quiet) {
    try {
      D = await api("/data");
      if (open) {
        const still = D.conversations.find((c) => key(c) === key(open));
        if (still && tab === "inbox" && thread && still.count !== thread.messages.length) { thread = (await api(`/thread?rid=${encodeURIComponent(open.rid)}&channel=${open.channel}&who=${encodeURIComponent(open.who)}`)).conversation; still.unread = 0; }
        if (still) open = still;
      }
      render();
    } catch (e) { if (!quiet) toast(e.message, true); }
  }
  load();
  setInterval(() => { if (!document.hidden) load(true); }, 10000);
})();
