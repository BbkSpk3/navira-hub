/* Navira Hub - restaurant editor */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const base = `/admin/r/${RID}`;
  let S = null;            // state from the server: {data, photos, unpublished, live, versions, info}
  let D = null;            // the data being edited
  let dirty = false;
  let tab = "ai";
  const openCats = new Set();

  /* ---------- tiny helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const get = (path) => path.reduce((o, k) => (o == null ? o : o[k]), D);
  function set(path, val) { let o = D; for (const k of path.slice(0, -1)) o = o[k]; o[path[path.length - 1]] = val; markDirty(); }
  function toast(t, bad) { const el = $("#toast"); el.textContent = t; el.className = "toast show" + (bad ? " bad" : ""); clearTimeout(el._t); el._t = setTimeout(() => (el.className = "toast"), bad ? 6000 : 3000); }
  let uid = 0;

  async function api(path, opts) {
    const o = Object.assign({ method: "POST", headers: { "X-CSRF-Token": CSRF } }, opts || {});
    if (o.json) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(o.json); }
    let r, j;
    try { r = await fetch(base + path, o); j = await r.json(); }
    catch (e) { throw new Error("Could not reach the server. Check your internet and try again."); }
    if (r.status === 401) { location.href = "/admin/login"; throw new Error("Please log in again."); }
    if (!j.ok) throw new Error(j.error || "Something went wrong.");
    return j;
  }
  function apply(j, keepEdits) {
    S = j;
    if (!keepEdits) { D = JSON.parse(JSON.stringify(j.data)); dirty = false; }
    paintChrome();
  }
  function markDirty() { if (!dirty) { dirty = true; paintChrome(); } }
  function reloadPreview() { const f = $("#frame"); try { f.contentWindow.location.reload(); } catch (_) { f.src = f.src; } }

  function paintChrome() {
    $("#rName").textContent = D.name || RID;
    const st = $("#status");
    if (S.offline) { st.className = "pill grey"; st.textContent = "Website switched off"; }
    else if (!S.live) { st.className = "pill grey"; st.textContent = "Not live yet"; }
    else if (S.unpublished || dirty) { st.className = "pill amber"; st.textContent = "Changes not published"; }
    else { st.className = "pill green"; st.textContent = "Live"; }
    $("#viewLive").hidden = !S.live || S.offline;
    $("#publishBtn").textContent = S.live ? "Publish changes" : "Publish website";
    $("#publishBtn").disabled = S.live && !S.unpublished && !dirty;
    $("#saveBar").hidden = !dirty;
  }

  /* ---------- form building blocks ---------- */
  function field(label, path, o) {
    o = o || {};
    const id = "f" + ++uid;
    let val = get(path);
    if (o.csv) val = (val || []).join(", ");
    if (val == null) val = "";
    const onInput = (e) => {
      let v = e.target.value;
      if (o.csv) v = v.split(",").map((x) => x.trim()).filter(Boolean);
      else if (o.type === "number") v = v === "" ? "" : Number(v);
      set(path, v);
      if (o.onchange) o.onchange(v);
    };
    let input;
    if (o.type === "checkbox") {
      const box = h("input", { id, type: "checkbox", checked: !!get(path), onchange: (e) => { set(path, e.target.checked); if (o.onchange) o.onchange(e.target.checked); } });
      return h("div", { style: "margin-top:12px" }, h("label", { class: "switch", for: id }, box, h("span", { class: "track" }), h("span", { class: "lbl", text: label })), o.hint ? h("p", { class: "hint", text: o.hint }) : null);
    }
    if (o.type === "photo") { input = h("select", { id, onchange: onInput }, h("option", { value: "", text: "No photo" }), S.photos.map((p) => h("option", { value: "photos/" + p, text: p }))); input.value = val; }
    else if (o.type === "textarea") input = h("textarea", { id, rows: o.rows || 3, placeholder: o.placeholder, maxlength: o.max, oninput: onInput, value: val });
    else if (o.type === "select") { input = h("select", { id, onchange: onInput }, o.options.map((op) => h("option", { value: op[0], text: op[1] }))); input.value = val; }
    else if (o.type === "color") {
      const txt = h("input", { type: "text", value: val, maxlength: 7, "aria-label": label + " code", oninput: (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { pick.value = e.target.value; set(path, e.target.value); } } });
      const pick = h("input", { id, type: "color", value: /^#[0-9a-fA-F]{6}$/.test(val) ? val : "#000000", oninput: (e) => { txt.value = e.target.value; set(path, e.target.value); } });
      input = h("div", { class: "color-row" }, pick, txt);
    } else input = h("input", { id, type: o.type || "text", placeholder: o.placeholder, maxlength: o.max, min: o.min, max: o.maxNum, step: o.step, oninput: onInput, value: val });
    return h("div", {}, h("label", { for: id, text: label }), input, o.hint ? h("p", { class: "hint", text: o.hint }) : null);
  }
  const group = (title, ...kids) => h("div", { class: "group" }, h("h3", { text: title }), ...kids);

  /* A list of things (offers, FAQ, dishes...) with add / remove / move */
  function list(path, cols, o) {
    o = o || {};
    const arr = get(path) || [];
    const wrap = h("div", {});
    const rows = h("div", { class: "rows" });
    arr.forEach((item, i) => {
      const cells = cols.map((c) => {
        let v = item[c.key];
        if (c.csv) v = (v || []).join(", ");
        const onInput = (e) => {
          let nv = e.target.value;
          if (c.csv) nv = nv.split(",").map((x) => x.trim()).filter(Boolean);
          if (c.type === "number") nv = nv === "" ? "" : Number(nv);
          if ((c.csv && !nv.length) || (c.optional && nv === "")) delete item[c.key]; else item[c.key] = nv;
          markDirty();
        };
        let input;
        if (c.type === "textarea") input = h("textarea", { rows: 1, placeholder: c.label, "aria-label": c.label, oninput: onInput, value: v == null ? "" : v });
        else if (c.type === "photo") { input = h("select", { "aria-label": c.label, onchange: onInput }, h("option", { value: "", text: c.label + ": none" }), S.photos.map((p) => h("option", { value: "photos/" + p, text: "Photo: " + p }))); input.value = v || ""; }
        else if (c.type === "select") { input = h("select", { "aria-label": c.label, onchange: onInput }, c.options.map((o) => h("option", { value: o[0], text: o[1] }))); input.value = v || c.options[0][0]; }
        else input = h("input", { type: c.type || "text", step: c.step, min: c.type === "number" ? 0 : null, placeholder: c.label, "aria-label": c.label, oninput: onInput, value: v == null ? "" : v });
        return h("div", { class: c.wide ? "wide" : "" }, input);
      });
      const tools = h("div", { class: "row-tools" },
        h("button", { type: "button", class: "icon-btn", title: "Move up", "aria-label": "Move up", disabled: i === 0, onclick: () => { arr.splice(i - 1, 0, arr.splice(i, 1)[0]); markDirty(); render(); } }, "↑"),
        h("button", { type: "button", class: "icon-btn del", title: "Remove", "aria-label": "Remove", onclick: () => { arr.splice(i, 1); markDirty(); render(); } }, "✕"));
      const row = h("div", { class: "row " + (o.rowClass || "") }, ...cells.slice(0, o.inline || cells.length), tools, ...cells.slice(o.inline || cells.length));
      if (!o.rowClass) row.style.gridTemplateColumns = "1fr 60px";
      if (!o.rowClass) cells.forEach((c) => (c.style.gridColumn = "1"));
      if (!o.rowClass) { tools.style.gridColumn = "2"; tools.style.gridRow = "1"; }
      rows.append(row);
    });
    wrap.append(rows, h("button", { type: "button", class: "btn sm add-btn", onclick: () => { if (!get(path)) set(path, []); get(path).push(JSON.parse(JSON.stringify(o.blank || {}))); markDirty(); render(); } }, "+ " + (o.add || "Add")));
    return wrap;
  }

  /* ---------- tabs ---------- */
  /* The admin menu (the ☰ button). Each item shows one part of a bigger settings screen. */
  const MENU = [
    { id: "ai", label: "Build with AI", icon: "💬" },
    { head: "Website content" },
    { id: "basics", label: "Name & texts", view: "basics" },
    { id: "hours", label: "Opening hours & contact", view: "contact", groups: ["Opening hours", "Contact"] },
    { id: "links", label: "Booking & review links", view: "contact", groups: ["Links"] },
    { id: "ordering", label: "Online ordering & delivery apps", view: "contact", groups: ["Online ordering"] },
    { id: "social", label: "Social media links", view: "contact", groups: ["Social media"] },
    { id: "offers", label: "Offers", view: "extras", groups: ["Offers"] },
    { id: "festive", label: "Festive section", view: "festive", loose: true },
    { id: "features", label: "Feature boxes", view: "extras", groups: ["What you offer"] },
    { id: "menu", label: "Food menu", view: "menu", loose: true },
    { id: "photos", label: "Photos & gallery", view: "photos", loose: true },
    { id: "reviews", label: "Reviews", view: "extras", groups: ["Reviews"] },
    { id: "faq", label: "Questions & answers", view: "extras", groups: ["Questions"] },
    { id: "own", label: "Your own sections", view: "design", groups: ["Your own sections"] },
    { head: "Design" },
    { id: "design", label: "Template, colours & layouts", view: "design", groups: ["Template", "Colours", "Fonts", "Buttons", "Layout", "Movement", "Custom CSS"], loose: true },
    { id: "layouts", label: "Section templates (10 each)", view: "design", groups: ["Layout of each section"] },
    { id: "bars", label: "Menu bar & phone bar", view: "design", groups: ["Menu bar", "Bottom bar on phones"] },
    { id: "sections", label: "Section order & pages", view: "design", groups: ["Sections:", "Section headings"] },
    { id: "credit", label: "Footer & Navira credit", view: "design", groups: ["Footer credit"] },
    { head: "Booking & chat" },
    { id: "booking", label: "Table booking", view: "chat", groups: ["Table booking"] },
    { id: "assistant", label: "Chat assistant", view: "chat", groups: ["AI assistant on / off", "How the assistant talks", "Use the chat on another website"], loose: true },
    { id: "meta", label: "Facebook & Instagram messages", view: "chat", groups: ["Facebook & Instagram"] },
    { id: "whatsapp", label: "WhatsApp", view: "chat", groups: ["WhatsApp"] },
    { id: "limit", label: "AI monthly limit", view: "chat", groups: ["AI monthly limit"] },
    { id: "knowledge", label: "AI knowledge (files & links)", view: "knowledge", loose: true },
    { id: "messages", label: "Messages & bookings ↗", href: "/admin/messages" },
    { head: "Go live" },
    { id: "live", label: "Website address & domain", view: "live", groups: ["Website address"] },
    { id: "privacy", label: "Privacy & cookie notice", view: "live", groups: ["Privacy notice", "Cookie notice"] },
    { id: "numbers", label: "Copy, export & numbers", view: "numbers", loose: true },
    { id: "history", label: "History (undo)", view: "live", groups: ["History"] },
    { id: "delete", label: "Switch off or delete", view: "live", groups: ["Switch off or delete"] },
  ];
  const item = () => MENU.find((m) => m.id === tab) || MENU[0];
  function build(m) {
    const all = VIEWS[m.view]().filter(Boolean);
    if (!m.groups) return all;
    return all.filter((el) => {
      const isGroup = el.classList && el.classList.contains("group");
      if (!isGroup) return !!m.loose;
      const title = (el.querySelector("h3") || {}).textContent || "";
      return m.groups.some((g) => title.startsWith(g));
    });
  }

  const VIEWS = {
    basics: () => [
      group("About the restaurant",
        field("Restaurant name", ["name"], { max: 80, onchange: paintChrome }),
        field("Short line under the name", ["tagline"], { placeholder: "Nepalese & Indian Restaurant", max: 80 }),
        field("Big headline on the home page", ["headline"], { max: 120 }),
        field("Welcome text", ["intro"], { type: "textarea", max: 400 }),
        field("About us", ["about"], { type: "textarea", rows: 4, max: 900 })),
      group("Country and region",
        h("p", { class: "hint", text: "Used to filter the restaurants on the dashboard. It is not shown on the website." }),
        h("div", { class: "two" },
          field("Country", ["location", "country"], { type: "select", options: [["", "Not set"], ...S.info.countries.map((c) => [c, c])], onchange: () => render() }),
          (() => { const f = field("Region", ["location", "region"], { max: 60, placeholder: "e.g. West Midlands" }); const dl = h("datalist", { id: "regionList" }, (S.info.regions[D.location.country] || []).map((r) => h("option", { value: r }))); f.querySelector("input").setAttribute("list", "regionList"); f.append(dl); return f; })())),
      group("For Google",
        field("One-sentence description for search results", ["seo", "description"], { type: "textarea", rows: 2, max: 200 })),
    ],

    design: () => {
      const i = S.info, pre = i.presets[D.theme.style] || {};
      const pv = (key) => (key === "about" ? pre.about_layout : pre[key]);
      const opt = (key) => [["", key in i.extra_defaults ? "Standard" + (i.extra_defaults[key] ? ` (${i.options[key][i.extra_defaults[key]]})` : "") : `From the template (${(i.options[key] || {})[pv(key)] || pv(key)})`], ...Object.entries(i.options[key])];
      const fontOpt = (key) => [["", `From the template (${pre[key]})`], ...i.fonts.map((f) => [f, f])];
      const sel = (label, key) => field(label, ["design", key], { type: "select", options: opt(key) });
      /* the 10 templates, as cards you click */
      const picker = h("div", { class: "tpl-grid", role: "radiogroup", "aria-label": "Template" }, Object.entries(i.presets).map(([k, v]) =>
        h("button", { type: "button", class: "tpl" + (D.theme.style === k ? " on" : ""), role: "radio", "aria-checked": String(D.theme.style === k), onclick: () => { set(["theme", "style"], k); render(); } },
          h("span", { class: "tpl-prev", style: `background:${v.bg};color:${v.text}` },
            h("i", { style: `background:${v.colors[0]}` }), h("b", { style: `border-radius:${Math.min(v.radius, 10)}px;background:${v.colors[1]}` }), h("em", { text: "Aa" })),
          h("strong", { text: v.label }), h("small", { text: v.about }))));
      const clearLayouts = () => { ["buttons", "hero", "nav", "offers", "about", "features", "menu", "gallery", "reviews", "faq", "visit", "marquee", "motion", "heading_font", "body_font", "bg", "text", "radius", "festive", "menu_nav", "nav_cta"].forEach((k) => (D.design[k] = "")); markDirty(); render(); };
      /* tick boxes that keep their order: used for the menu bar and the phone bar */
      const pickList = (key, choices, o) => {
        o = o || {};
        const cur = (D.design[key] || []).filter((k) => k in choices);
        const shown = [...cur, ...Object.keys(choices).filter((k) => !cur.includes(k))];
        return h("div", { class: "rows" }, shown.map((k) => {
          const on = cur.includes(k), at = cur.indexOf(k);
          const box = h("input", { type: "checkbox", checked: on, disabled: !on && o.max && cur.length >= o.max, "aria-label": choices[k],
            onchange: (e) => { set(["design", key], e.target.checked ? [...cur, k] : cur.filter((x) => x !== k)); render(); } });
          const mv = (by) => { const n = cur.slice(); n.splice(at + by, 0, n.splice(at, 1)[0]); set(["design", key], n); render(); };
          return h("div", { class: "row order-row" + (on ? "" : " off") },
            h("label", { class: "switch" }, box, h("span", { class: "track" }), h("span", { class: "lbl", text: choices[k] + (on && o.lastMain && at === cur.length - 1 ? "  (highlighted)" : "") })),
            h("span", {}),
            h("div", { class: "row-tools" },
              h("button", { type: "button", class: "icon-btn", title: "Move up", "aria-label": "Move " + choices[k] + " up", disabled: !on || at === 0, onclick: () => mv(-1) }, "↑"),
              h("button", { type: "button", class: "icon-btn", title: "Move down", "aria-label": "Move " + choices[k] + " down", disabled: !on || at === cur.length - 1, onclick: () => mv(1) }, "↓")));
        }));
      };
      const noBar = (D.design.mbar || []).includes("none");
      const optColour = (label, key) => {          // a colour that can be left "automatic"
        const cur = D.design[key];
        const pick = h("input", { type: "color", value: cur || pre[key], "aria-label": label, oninput: (e) => { set(["design", key], e.target.value); note.textContent = e.target.value; } });
        const note = h("span", { class: "hint", text: cur || "from the style" });
        return h("div", {}, h("label", { text: label }), h("div", { class: "color-row" }, pick, note,
          cur ? h("button", { type: "button", class: "btn sm quiet", onclick: () => { set(["design", key], ""); render(); } }, "Reset") : null));
      };
      /* section order + show / hide */
      const customs = D.sections.map((c) => [c.id, c.title || c.nav || c.id]);
      const names = Object.assign({}, i.builtin_sections, Object.fromEntries(customs));
      const def = ["festive", "offers", "about", "features", "menu", "gallery", "reviews", "faq", ...customs.map((c) => c[0]), "order", "visit"];
      let order = [...new Set((D.design.order || []).filter((k) => def.includes(k)))];
      def.forEach((k) => { if (!order.includes(k)) { const v = order.indexOf("visit"); if (v >= 0 && k !== "visit") order.splice(v, 0, k); else order.push(k); } });
      const move = (idx, by) => { const o = order.slice(); o.splice(idx + by, 0, o.splice(idx, 1)[0]); set(["design", "order"], o); render(); };
      const rowsEl = h("div", { class: "rows" }, order.map((k, idx) => {
        const hidden = D.design.hidden.includes(k);
        const box = h("input", { type: "checkbox", checked: !hidden, "aria-label": "Show " + names[k], onchange: (e) => { set(["design", "hidden"], e.target.checked ? D.design.hidden.filter((x) => x !== k) : [...D.design.hidden, k]); render(); } });
        const paged = D.design.pages.includes(k);
        const pg = h("input", { type: "checkbox", checked: paged, onchange: (e) => { set(["design", "pages"], e.target.checked ? [...D.design.pages, k] : D.design.pages.filter((x) => x !== k)); } });
        return h("div", { class: "row order-row" + (hidden ? " off" : "") },
          h("label", { class: "switch" }, box, h("span", { class: "track" }), h("span", { class: "lbl", text: names[k] })),
          h("label", { class: "own-page" }, pg, "Own page"),
          h("div", { class: "row-tools" },
            h("button", { type: "button", class: "icon-btn", title: "Move up", "aria-label": "Move " + names[k] + " up", disabled: idx === 0, onclick: () => move(idx, -1) }, "↑"),
            h("button", { type: "button", class: "icon-btn", title: "Move down", "aria-label": "Move " + names[k] + " down", disabled: idx === order.length - 1, onclick: () => move(idx, 1) }, "↓")));
      }));
      /* headings */
      const tKeys = ["offers", "about", "menu", "gallery", "reviews", "faq", "order", "visit"];
      const tField = (k, f, ph) => h("input", { type: "text", placeholder: ph, "aria-label": `${names[k]} ${f}`, value: ((D.design.titles[k] || {})[f]) || "", oninput: (e) => { const t = D.design.titles; t[k] = t[k] || {}; if (e.target.value) t[k][f] = e.target.value; else delete t[k][f]; markDirty(); } });
      /* own sections */
      const own = D.sections.map((c, ci) => {
        const sum = h("summary", {}, h("span", { text: c.title || c.nav || "New section" }), h("small", { text: i.layouts[c.layout] || "" }));
        const det = h("details", { class: "cat", open: openCats.has(c) }, sum, h("div", { class: "cat-in" },
          h("div", { class: "two" }, field("Title", ["sections", ci, "title"], { onchange: (v) => (sum.firstChild.textContent = v || "New section") }), field("Name in the menu bar (optional)", ["sections", ci, "nav"], { placeholder: "Rooms" })),
          field("Small line above the title (optional)", ["sections", ci, "eyebrow"]),
          field("Text", ["sections", ci, "text"], { type: "textarea", rows: 4 }),
          h("div", { class: "two" }, field("Layout", ["sections", ci, "layout"], { type: "select", options: Object.entries(i.layouts) }), field("Background", ["sections", ci, "band"], { type: "select", options: Object.entries(i.bands) })),
          field("Photo", ["sections", ci, "image"], { type: "photo" }),
          h("h3", { text: "List or cards (optional)" }),
          list(["sections", ci, "items"], [{ key: "title", label: "Name" }, { key: "price", label: "Price or note (optional)" }, { key: "text", label: "Text (optional)", type: "textarea" }, { key: "image", label: "Photo (for cards)", type: "photo" }, { key: "image_pos", label: "Where the photo goes", type: "select", options: Object.entries({ top: "Photo above the text", bottom: "Photo under the text", background: "Photo behind the text" }) }], { add: "Add item", blank: { title: "", price: "", text: "", image: "", image_pos: "top" } }),
          h("div", { class: "two" }, field("Button text (optional)", ["sections", ci, "button_text"]), field("Button link", ["sections", ci, "button_url"], { placeholder: "https://…" })),
          h("button", { type: "button", class: "btn sm danger add-btn", onclick: () => { if (confirm(`Remove the section "${c.title || "New section"}"?`)) { D.sections.splice(ci, 1); markDirty(); render(); } } }, "Remove this section")));
        det.addEventListener("toggle", () => (det.open ? openCats.add(c) : openCats.delete(c)));
        return det;
      });
      return [
        h("p", { class: "hint", text: "Tip: you can also just tell the AI what you want in “Build with AI”, e.g. “make it dark green and gold with rounded buttons”, “move the menu to the top”, “add a section about our rooms”." }),
        group("Template (10 to choose from)", picker,
          h("p", { class: "hint", text: "A template sets the fonts, background and the layout of every section. Your words, menu and photos stay. Everything below fine-tunes it; “From the template” means: not changed." }),
          h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px" },
            h("button", { type: "button", class: "btn sm", onclick: () => { D.theme.color = pre.colors[0]; D.theme.accent = pre.colors[1]; markDirty(); render(); } }, "Use this template's colours"),
            h("button", { type: "button", class: "btn sm", onclick: clearLayouts }, "Reset my changes to the template"))),
        group("Colours",
          h("div", { class: "two" }, field("Main colour", ["theme", "color"], { type: "color" }), field("Second colour", ["theme", "accent"], { type: "color" })),
          h("div", { class: "two" }, optColour("Page background", "bg"), optColour("Text colour", "text"))),
        group("Fonts",
          h("div", { class: "two" }, field("Headings", ["design", "heading_font"], { type: "select", options: fontOpt("heading_font") }), field("Normal text", ["design", "body_font"], { type: "select", options: fontOpt("body_font") }))),
        group("Buttons and corners",
          h("div", { class: "two" }, sel("Buttons", "buttons"),
            field("Corner roundness (0 to 40)", ["design", "radius"], { type: "number", min: 0, maxNum: 40, placeholder: "From the template (" + pre.radius + ")" }))),
        group("Layout of each section (10 templates each)",
          h("p", { class: "hint", text: "Pick a template for every section on its own. The preview on the right changes as soon as you press Save." }),
          h("div", { class: "two" }, sel("Offers", "offers"), sel("Festive section", "festive")),
          h("div", { class: "two" }, sel("Feature boxes", "features"), sel("Food menu", "menu")),
          h("div", { class: "two" }, sel("Reviews", "reviews"), sel("Gallery", "gallery")),
          h("div", { class: "two" }, sel("Hours, map & contact", "visit"), sel("Questions & answers", "faq")),
          h("div", { class: "two" }, sel("Top of the page", "hero"), sel("About", "about")),
          h("div", { class: "two" }, sel("Menu's section buttons", "menu_nav"), h("div", {})),
          h("p", { class: "hint", text: "Reviews: “One review at a time” and “Row of cards” slide by themselves every few seconds, with arrows to go back and forward. Gallery: tapping any photo opens it big, and swiping or the arrows go to the next photo." })),
        group("Menu bar (top of the website)",
          h("div", { class: "two" }, sel("Style of the bar", "nav"), sel("Buttons in the bar", "nav_cta")),
          h("h3", { text: "Sections named in the bar" }),
          h("p", { class: "hint", text: "Tick the sections you want in the menu bar and put them in order. Nothing ticked = the usual ones (Offers, About, Menu, Gallery, Visit). Sections with nothing in them are skipped." }),
          pickList("nav_show", Object.fromEntries(order.filter((k) => !D.design.hidden.includes(k)).map((k) => [k, names[k]])))),
        group("Bottom bar on phones",
          h("p", { class: "hint", text: "The bar that stays at the bottom of the screen on phones. Choose up to 4 buttons and their order. The last one is the highlighted one. Nothing ticked = Call, Order, Book. A button only shows if it can work (for example “Order” needs an ordering link)." }),
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: noBar, onchange: (e) => { set(["design", "mbar"], e.target.checked ? ["none"] : []); render(); } }), " No bar at the bottom"),
          noBar ? null : pickList("mbar", i.mbar_options, { max: 4, lastMain: true })),
        group("Footer credit (Navira Technology)",
          h("p", { class: "hint", text: "The small line at the very bottom of the website." }),
          field("What to show", ["credit", "style"], { type: "select", options: Object.entries(i.credits), onchange: () => render() }),
          D.credit.style === "custom" ? field("Your own words (they link to naviratechnology.com)", ["credit", "text"], { max: 120, placeholder: "Made with care by Navira Technology" }) : null),
        group("Movement",
          h("div", { class: "two" }, sel("Animations", "motion"), sel("Moving band of words", "marquee")),
          h("p", { class: "hint", text: "Sections fade and slide in as people scroll. “Lively” adds a slow zoom on the top photo, a shine on the main button and lifting cards. Visitors who ask their phone for less motion always get none." })),
        group("Sections: order, show or hide, own page", h("p", { class: "hint", text: "Switch = show or hide. Tick “Own page” to move a section off the home page onto its own page (e.g. Menu, Gallery); the menu bar then links to it. Sections with nothing in them are skipped automatically." }), rowsEl),
        group("Section headings (optional)", h("p", { class: "hint", text: "Leave empty to keep the normal words." }),
          ...tKeys.map((k) => h("div", { class: "title-row" }, h("span", { text: names[k] }), tField(k, "eyebrow", "Small line"), tField(k, "title", "Heading")))),
        h("div", { class: "group" }, h("h3", { text: "Your own sections" }),
          h("p", { class: "hint", text: "Add anything the template does not have: rooms, live sports, private hire, our story, catering…" }),
          ...own,
          h("button", { type: "button", class: "btn add-btn", onclick: () => { const c = { id: "", nav: "", eyebrow: "", title: "New section", text: "", image: "", layout: "image-right", band: "", items: [], button_text: "", button_url: "" }; D.sections.push(c); openCats.add(c); markDirty(); render(); } }, "+ Add a section")),
        group("Custom CSS (advanced)",
          field("Extra CSS", ["design", "custom_css"], { type: "textarea", rows: 8, hint: "For fine details. Easiest way: ask the AI (“make the headings bigger and add a thin gold line under them”) and it writes this for you." })),
      ];
    },

    contact: () => {
      const hours = D.hours;
      const rows = hours.map((hr) => {
        const closed = !hr[1];
        const open = h("input", { type: "time", value: hr[1] || "", disabled: closed, "aria-label": hr[0] + " opens", oninput: (e) => { hr[1] = e.target.value; markDirty(); } });
        const close = h("input", { type: "time", value: hr[2] || "", disabled: closed, "aria-label": hr[0] + " closes", oninput: (e) => { hr[2] = e.target.value; markDirty(); } });
        const box = h("input", { type: "checkbox", checked: closed, onchange: (e) => { if (e.target.checked) { hr[1] = null; hr[2] = null; } else { hr[1] = "12:00"; hr[2] = "22:00"; } markDirty(); render(); } });
        return h("div", { class: "hours-row" }, h("span", { text: hr[0] }), open, close, h("label", {}, box, "Closed"));
      });
      return [
        group("Opening hours", ...rows, field("Extra note (optional)", ["hours_note"], { placeholder: "Kitchen closes at 9pm" })),
        group("Contact",
          h("div", { class: "two" }, field("Phone", ["contact", "phone"], { type: "tel" }), field("Email", ["contact", "email"], { type: "email" })),
          field("Address", ["contact", "address"], { hint: "Used for the map on the website." })),
        group("Links",
          field("Table booking link", ["links", "booking_url"], { type: "url", placeholder: "https://reserve.naviratechnology.com/rest/…", hint: S.info.booking_link_hint ? "Your Navira booking page: " + S.info.booking_link_hint : "" }),
          field("Google reviews link", ["links", "google_reviews"], { type: "url" })),
        group("Online ordering",
          h("p", { class: "hint", text: "Your own ordering link is always the big main button on the website (top of the page, menu bar, phone bar, and the “Order online” section). Delivery apps are shown smaller underneath as “Also on”, so customers are pushed to order direct." }),
          field("Your own ordering link (Navira ordering app)", ["links", "order_url"], { type: "url", placeholder: "https://order…" }),
          h("div", { class: "two" },
            field("Words on the main button", ["links", "order_label"], { placeholder: "Order direct", max: 30 }),
            field("Short line above the button", ["links", "order_note"], { placeholder: "Order straight from us: the best prices…", max: 140 })),
          h("h3", { text: "Delivery apps (optional, shown smaller)" }),
          ...pairs(Object.entries(S.info.order_platforms).map(([k, name]) => field(name + " link", ["links", k], { type: "url", placeholder: "https://…" }))),
          h("p", { class: "hint", text: "The “Order online” section appears by itself when any of these links is filled in. Move or hide it in “Section order & pages”." })),
        group("Social media",
          h("p", { class: "hint", text: "Paste the full address of each page. The ones you fill in are shown in the footer, in the phone menu and beside the contact details." }),
          ...pairs(Object.entries(S.info.socials).map(([k, name]) => field(name, ["links", k], { type: "url", placeholder: k === "whatsapp" ? "https://wa.me/447…" : "https://…" })))),
      ];
    },

    extras: () => {
      const pos = [["top", "Photo above the text"], ["bottom", "Photo under the text"], ["background", "Photo behind the text"]];
      return [
        group("Offers",
          h("p", { class: "hint", text: "Each offer can have a photo, a button and a link. The first offer also shows in the chip at the top of the page; the chip changes every 5 seconds through all offers." }),
          list(["offers"], [
            { key: "title", label: "Offer (e.g. 15% off)" }, { key: "text", label: "Details", type: "textarea" },
            { key: "image", label: "Photo", type: "photo" }, { key: "image_pos", label: "Where the photo goes", type: "select", options: pos },
            { key: "button_text", label: "Button text (optional), e.g. Order now" }, { key: "button_url", label: "Button link (optional), https://…" },
          ], { add: "Add offer", blank: { title: "", text: "", image: "", image_pos: "top", button_text: "", button_url: "" } }),
          h("p", { class: "hint", text: "Button with no link: it opens the table booking form. Offers with a photo or button are shown as big cards." })),
        group("What you offer (boxes with a photo)", list(["features"], [
          { key: "title", label: "Title" }, { key: "text", label: "Short text", type: "textarea" },
          { key: "image", label: "Photo", type: "photo" }, { key: "image_pos", label: "Where the photo goes", type: "select", options: pos },
        ], { add: "Add box", blank: { title: "", text: "", image: "", image_pos: "top" } })),
        group("Questions & answers", list(["faq"], [{ key: "q", label: "Question" }, { key: "a", label: "Answer", type: "textarea" }], { add: "Add question", blank: { q: "", a: "" } })),
        group("Reviews",
          h("div", { class: "two" }, field("Star rating (e.g. 4.6)", ["reviews_summary", "rating"], { type: "number", step: "0.1", min: 0, maxNum: 5 }), field("Number of reviews", ["reviews_summary", "count"], { type: "number", min: 0 })),
          field("Link to all reviews (Google)", ["links", "google_reviews"], { type: "url", placeholder: "https://…" }),
          list(["reviews"], [{ key: "text", label: "What they said", type: "textarea" }, { key: "author", label: "Name" }], { add: "Add review", blank: { text: "", author: "" } }),
          h("p", { class: "hint", text: "Only add real reviews from real customers." })),
      ];
    },

    festive: () => {
      const f = D.festive, showing = S.info.festive_showing;
      return [
        h("p", { class: "hint", text: "A special coloured section near the top of the website for any festival or seasonal offer: Christmas menu, New Year's Eve, Dashain, Tihar, Eid, Valentine's, Mother's Day… One at a time. Change it whenever the season changes." }),
        f.enabled ? h("p", { class: "alert " + (showing ? "ok" : "warn"), text: showing ? "The festive section is switched on and showing (after you Save)." : "Switched on, but not showing in the saved draft: check the dates below, or Save first." }) : null,
        group("Show it",
          field("Show the festive section on the website", ["festive", "enabled"], { type: "checkbox" }),
          field("Also show a thin banner at the very top of the page", ["festive", "banner"], { type: "checkbox" }),
          h("div", { class: "two" },
            field("Start showing on (optional)", ["festive", "start"], { type: "date" }),
            field("Stop showing after (optional)", ["festive", "end"], { type: "date" })),
          h("p", { class: "hint", text: "With dates, it appears and disappears by itself. Without dates, it shows until you switch it off." })),
        group("What it says",
          h("div", { class: "two" },
            field("Festival (sets the colours)", ["festive", "theme"], { type: "select", options: Object.entries(S.info.festivals), hint: "Change the colours or add your own festival on the Festivals page (link below)." }),
            field("Label (optional)", ["festive", "label"], { placeholder: "e.g. Bonfire Night", hint: "Leave empty to use the festival name." })),
          h("p", { class: "hint" }, [h("a", { href: "/admin/festivals", target: "_blank", text: "Manage festivals and colours →" })]),
          field("Title", ["festive", "title"], { placeholder: "Christmas Day at Namaste", max: 90 }),
          field("Text", ["festive", "text"], { type: "textarea", max: 500 }),
          field("When (shown to customers)", ["festive", "dates"], { placeholder: "Christmas Day, 3pm to 10pm" }),
          h("div", { class: "two" }, field("Photo", ["festive", "image"], { type: "photo", hint: "Upload photos in Photos first." }),
            field("Template (how the section looks)", ["design", "festive"], { type: "select", options: [["", "Standard (photo beside the words)"], ...Object.entries(S.info.options.festive)] }))),
        group("Set menus or deals (optional)",
          list(["festive", "items"], [{ key: "title", label: "Name, e.g. Veg set menu" }, { key: "price", label: "Price, e.g. £30 per person" }, { key: "text", label: "What's included", type: "textarea" }], { add: "Add set menu or deal", blank: { title: "", price: "", text: "" } })),
        group("Button",
          h("div", { class: "two" },
            field("Button text (optional)", ["festive", "button_text"], { placeholder: "Book your Christmas table" }),
            field("Button link (optional)", ["festive", "button_url"], { placeholder: "https://…" })),
          h("p", { class: "hint", text: "Leave both empty and the button goes to the table booking link (or the phone number)." })),
      ];
    },

    menu: () => {
      const out = [
        h("p", { class: "hint", text: "Tip: to build a whole menu fast, attach a photo or PDF of the menu in the AI box above and write “build the menu from this”." }),
        group("Note above the menu", field("Menu note", ["menu_note"], { placeholder: "Please tell us about any allergies." })),
        group("How the menu looks",
          h("div", { class: "two" },
            field("Menu template", ["design", "menu"], { type: "select", options: [["", "From the website template"], ...Object.entries(S.info.options.menu)] }),
            field("Section buttons (Starters, Mains…)", ["design", "menu_nav"], { type: "select", options: [["", "Standard (a row you slide sideways)"], ...Object.entries(S.info.options.menu_nav)] })),
          h("p", { class: "hint", text: "Each dish and each section can have a photo: upload photos in “Photos & gallery” first, then choose them below. Dish photos look best with the templates “Photo cards” or “Rows with a small photo”." })),
      ];
      D.menu.forEach((cat, ci) => {
        const sum = h("summary", {}, h("span", { text: cat.category || "(no name)" }), h("small", { text: cat.items.length + " dishes" }));
        const body = h("div", { class: "cat-in" },
          h("div", { class: "two" }, field("Section name", ["menu", ci, "category"], { onchange: (v) => (sum.firstChild.textContent = v || "(no name)") }), field("Section note (optional)", ["menu", ci, "note"], { placeholder: "Sundays only" })),
          field("Photo for this section (optional)", ["menu", ci, "image"], { type: "photo", hint: "Shown as a banner above the section's dishes." }),
          list(["menu", ci, "items"], [
            { key: "name", label: "Dish name" }, { key: "price", label: "£", type: "number", step: "0.01" },
            { key: "description", label: "Description (optional)", type: "textarea", wide: true, optional: true },
            { key: "allergens", label: "Allergens, with commas (optional)", csv: true, wide: true },
            { key: "tags", label: "Tags: V, VG, GF, H, HOT, NEW (optional)", csv: true, wide: true },
            { key: "image", label: "Dish photo", type: "photo", wide: true, optional: true },
          ], { add: "Add dish", blank: { name: "", price: 0 }, rowClass: "dish-row", inline: 2 }),
          h("div", { style: "display:flex;gap:8px;margin-top:14px" },
            h("button", { type: "button", class: "btn sm", disabled: ci === 0, onclick: () => { D.menu.splice(ci - 1, 0, D.menu.splice(ci, 1)[0]); markDirty(); render(); } }, "↑ Move section up"),
            h("button", { type: "button", class: "btn sm danger", onclick: () => { if (confirm(`Remove the whole "${cat.category}" section and its ${cat.items.length} dishes?`)) { D.menu.splice(ci, 1); markDirty(); render(); } } }, "Remove section")));
        const det = h("details", { class: "cat", open: openCats.has(cat) }, sum, body);
        det.addEventListener("toggle", () => (det.open ? openCats.add(cat) : openCats.delete(cat)));
        out.push(det);
      });
      out.push(h("button", { type: "button", class: "btn add-btn", onclick: () => { const c = { category: "New section", items: [] }; D.menu.push(c); openCats.add(c); markDirty(); render(); } }, "+ Add menu section"));
      return out;
    },

    photos: () => {
      const input = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: (e) => upload(e.target.files) });
      const drop = h("div", { class: "drop", tabindex: 0, role: "button", onclick: () => input.click(), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } } },
        h("strong", { text: "Click to upload photos" }), h("p", { class: "hint", text: "or drag them here · JPG, PNG or WEBP · they are made smaller automatically so the website loads fast" }), input);
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); upload(e.dataTransfer.files); });
      const use = (label, on, fn) => h("button", { type: "button", class: "chip-btn" + (on ? " on" : ""), "aria-pressed": String(on), onclick: () => { fn(); markDirty(); render(); } }, label);
      const grid = h("div", { class: "photos" }, S.photos.map((p) => {
        const ref = "photos/" + p;
        const inGal = D.gallery.includes(ref);
        return h("div", { class: "photo" }, h("img", { src: `/media/${RID}/${encodeURIComponent(p)}`, alt: p, loading: "lazy" }),
          h("div", { class: "uses" },
            use("Logo", D.logo === ref, () => (D.logo = D.logo === ref ? "" : ref)),
            use("Main photo", D.hero_image === ref, () => (D.hero_image = D.hero_image === ref ? "" : ref)),
            use("About photo", D.about_image === ref, () => (D.about_image = D.about_image === ref ? "" : ref)),
            use("Gallery", inGal, () => (inGal ? D.gallery.splice(D.gallery.indexOf(ref), 1) : D.gallery.push(ref))),
            h("button", { type: "button", class: "chip-btn del", onclick: () => removePhoto(p) }, "Delete")));
      }));
      return [drop, h("p", { class: "hint", text: "Click the buttons under a photo to choose where it is used. Then press Save." }), S.photos.length ? grid : h("p", { class: "muted", text: "No photos yet." })];
    },

    chat: () => {
      const sw = (ch, label, hint) => {
        const box = h("input", { type: "checkbox", checked: !!D.chat.ai[ch], onchange: async () => {
          try { await api("/switch", { json: { channel: ch, on: box.checked } }); D.chat.ai[ch] = box.checked; S.data.chat.ai[ch] = box.checked; toast(`AI turned ${box.checked ? "on" : "off"} for ${label}`); if (ch === "website") reloadPreview(); }
          catch (e) { box.checked = !box.checked; toast(e.message, true); }
        } });
        return h("div", { style: "margin-top:10px" }, h("label", { class: "switch" }, box, h("span", { class: "track" }), h("span", { class: "lbl", text: label })), h("p", { class: "hint", text: hint }));
      };
      const line = (ok, text) => h("div", { class: "status-line" }, h("span", { class: "dot " + (ok ? "ok" : "no") }), text);
      const i = S.info;
      return [
        !i.ai_ready ? h("p", { class: "alert warn", text: "The AI is not connected: add ANTHROPIC_API_KEY to the Environment Variables." }) : null,
        group("AI assistant on / off (works straight away)",
          sw("website", "Website chat", "Off: the chat button is hidden on the website."),
          sw("facebook", "Facebook Messenger", "Off: the AI stays silent and staff answer by hand."),
          sw("instagram", "Instagram messages", "Off: the AI stays silent and staff answer by hand."),
          sw("whatsapp", "WhatsApp", "Off: messages are kept in Messages for staff to answer by hand.")),
        group("Table booking (Navira)",
          field("Navira booking slug", ["chat", "navira_slug"], { placeholder: "namastewolverhampton", hint: "The name at the end of the restaurant's Navira booking link. Leave empty and the AI only answers questions." }),
          h("div", { class: "two" }, field("Biggest group that can book online", ["chat", "max_party"], { type: "number", min: 1 }), field("How many days ahead", ["chat", "days_ahead"], { type: "number", min: 1 })),
          field("“Book a table” buttons on the website", ["design", "booking"], { type: "select", options: [["", "Booking form inside the website, if a Navira slug is set"], ["popup", "Booking form inside the website (Navira)"], ["link", "Open the table booking link instead"]] }),
          field("Booking form style", ["design", "booking_style"], { type: "select", options: [["", "From the template (" + i.options.booking_style[(i.presets[D.theme.style] || {}).booking_style || "steps"] + ")"], ...Object.entries(i.options.booking_style)] }),
          h("p", { class: "hint", text: "When a customer picks the biggest group allowed online, the form tells them to contact the restaurant directly for a bigger group." }),
          h("p", { class: "hint", text: i.booking_mode === "popup" ? "Now: the website has its own booking form. Bookings go straight into Navira. Share link: " + i.live_url + "book/" : i.booking_mode === "link" ? "Now: the buttons open the table booking link (Hours & contact tab)." : "Now: no booking buttons. Add a Navira slug, or a table booking link in Hours & contact." })),
        h("p", { class: "hint" }, "To read conversations, take over from the AI or reply yourself, open ", h("a", { href: "/admin/messages", text: "Messages & channels" }), "."),
        group("How the assistant talks",
          field("Assistant name", ["chat", "assistant_name"], { placeholder: (D.name || "Restaurant") + " assistant" }),
          field("First message", ["chat", "greeting"], { type: "textarea", rows: 2 }),
          field("Quick buttons (with commas)", ["chat", "quick_replies"], { csv: true }),
          field("Extra things the assistant should know", ["chat", "extra_info"], { type: "textarea", rows: 5, hint: "Parking, dogs, high chairs, set menus, deposit rules… It already knows everything on the website (after you publish)." })),
        group("Facebook & Instagram",
          line(i.meta_set, i.meta_set ? "Meta app is connected to this server." : "Meta app not connected yet (META_APP_SECRET and META_VERIFY_TOKEN are missing)."),
          line(i.token_set, i.token_set ? "This restaurant's Page token is set." : `Page token missing: add ${i.token_name} to the Environment Variables.`),
          h("div", { class: "two" }, field("Facebook Page ID", ["chat", "facebook_page_id"]), field("Instagram account ID", ["chat", "instagram_id"])),
          h("p", { class: "hint", text: "Webhook address to type into Meta:" }), copyBox(i.webhook_url),
          h("p", { class: "hint", text: "Full steps are in HOW-TO.txt (section “Facebook & Instagram”)." })),
        group("WhatsApp",
          h("p", { class: "hint", text: "Customers message the restaurant's WhatsApp Business number and the AI answers and takes bookings. Meta charges for some WhatsApp messages, so this starts switched off." }),
          line(i.meta_set, i.meta_set ? "Meta app is connected to this server." : "Meta app not connected yet (META_APP_SECRET and META_VERIFY_TOKEN are missing)."),
          line(i.wa_token_set, i.wa_token_set ? "WhatsApp token is set." : `WhatsApp token missing: add ${i.wa_token_name} (or one shared WHATSAPP_TOKEN) to the env file.`),
          field("WhatsApp phone number ID", ["chat", "whatsapp_phone_id"], { placeholder: "e.g. 123456789012345", hint: "From Meta: WhatsApp → API Setup → Phone number ID. This is not the phone number itself." }),
          h("p", { class: "hint", text: "Webhook address (the same one as Facebook and Instagram); subscribe to “messages”:" }), copyBox(i.webhook_url),
          h("p", { class: "hint", text: "Then switch WhatsApp on under “Chat assistant”. Full steps are in HOW-TO.txt (section “WhatsApp”)." })),
        group("AI monthly limit",
          h("p", { class: "hint", text: "Protects you from a big AI bill. When the restaurant reaches this number of AI replies in a month, the assistant stops and tells customers to call instead. It starts again on the 1st." }),
          field("Most AI replies in one month (0 = " + (i.env_limit ? "use the server limit of " + i.env_limit : "no limit") + ")", ["chat", "monthly_limit"], { type: "number", min: 0 }),
          h("p", { class: (i.ai_limit && i.stats.ai_this_month >= i.ai_limit) ? "alert warn" : "hint", text: `Used this month: ${i.stats.ai_this_month}` + (i.ai_limit ? ` of ${i.ai_limit}` : "") + " AI replies (website, Facebook, Instagram and WhatsApp together)." })),
        group("Use the chat on another website",
          h("p", { class: "hint", text: "If the restaurant keeps its old website, paste this line just before </body> on it:" }), copyBox(i.widget_code),
          field("Only allow the chat on these websites (with commas, optional)", ["chat", "allowed_websites"], { csv: true, placeholder: "https://www.restaurant.co.uk" })),
      ];
    },

    knowledge: () => {
      const input = h("input", { type: "file", multiple: true, hidden: true, accept: "image/*,application/pdf,.docx,.txt,.md,.csv", onchange: (e) => addKnowledge({ files: e.target.files }) });
      const drop = h("div", { class: "drop", tabindex: 0, role: "button", onclick: () => input.click(), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } } },
        h("strong", { text: "Click to upload files or photos" }), h("p", { class: "hint", text: "PDF, photo, Word (.docx) or text · e.g. allergen sheet, party packages, drinks list, a photo of the specials board" }), input);
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addKnowledge({ files: e.dataTransfer.files }); });
      const url = h("input", { type: "url", placeholder: "https://www.restaurant.co.uk/menu", "aria-label": "Web page link" });
      const title = h("input", { type: "text", placeholder: "Title, e.g. Deposit policy", "aria-label": "Note title" });
      const note = h("textarea", { rows: 3, placeholder: "Type anything customers might ask about…", "aria-label": "Note" });
      const kinds = { file: "File", link: "Link", note: "Note" };
      return [
        h("p", { class: "hint", text: "The chat assistant (website, Facebook, Instagram) answers from the published website PLUS everything here. Things you add here are used straight away." }),
        group("Upload files or photos", drop, h("p", { class: "hint", text: "The AI reads each file once and keeps the text. Photos and PDFs can take up to a minute." })),
        group("Add a web page link", h("div", { class: "add-line" }, url, h("button", { type: "button", class: "btn", onclick: () => url.value.trim() && addKnowledge({ url: url.value.trim() }) }, "Add link")),
          h("p", { class: "hint", text: "The text of the page is copied now. If the page changes later, delete it here and add it again." })),
        group("Type a note", title, h("div", { style: "margin-top:8px" }, note), h("button", { type: "button", class: "btn add-btn", onclick: () => note.value.trim() && addKnowledge({ note: note.value.trim(), title: title.value.trim() }) }, "Add note")),
        group(`What the assistant has (${S.sources.length})`,
          S.sources.length ? h("div", {}, S.sources.map((x) => h("div", { class: "source" },
            h("span", { class: "pill plain", text: kinds[x.kind] || "File" }),
            h("div", {}, h("strong", { text: x.title }), h("small", { text: `${x.added} · ${x.chars.toLocaleString()} characters · ${x.preview}` })),
            h("button", { type: "button", class: "icon-btn del", title: "Delete", "aria-label": "Delete " + x.title, onclick: () => removeKnowledge(x) }, "✕"))))
            : h("p", { class: "muted", text: "Nothing added yet. The assistant only knows what is on the website." })),
      ];
    },

    numbers: () => {
      const st = S.info.stats, T = st.total;
      const box = (n, label) => h("div", { style: "flex:1;min-width:110px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px" }, h("strong", { style: "display:block;font-size:24px", text: String(n) }), h("span", { class: "hint", text: label }));
      const cName = h("input", { type: "text", name: "name", required: true, maxlength: 80, placeholder: "Name of the new restaurant", "aria-label": "Name of the new restaurant" });
      const cId = h("input", { type: "text", name: "id", required: true, maxlength: 40, pattern: "[a-z0-9][a-z0-9\\-]{1,39}", placeholder: "short-name", "aria-label": "Short name for the web address" });
      cName.addEventListener("input", () => { cId.value = cName.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); });
      return [
        group("Numbers, last 30 days",
          h("div", { style: "display:flex;gap:10px;flex-wrap:wrap;margin-top:10px" }, box(T.visitors, "Visitors"), box(T.views, "Pages opened"), box(T.chats, "Chat messages"), box(T.bookings, "Bookings (form + AI)")),
          h("p", { class: "hint", text: "Counted without cookies; nothing personal is stored. Visitors counts each person once a day. Only the live website is counted, not this preview." }),
          h("details", {}, h("summary", { text: "Day by day" }),
            h("div", { style: "overflow-x:auto" }, h("table", { class: "mini-table", style: "width:100%;border-collapse:collapse;font-size:13px;margin-top:8px" },
              h("thead", {}, h("tr", {}, ["Day", "Visitors", "Pages", "Chats", "AI replies", "Bookings"].map((x) => h("th", { style: "text-align:left;padding:5px 6px;border-bottom:1px solid var(--line)", text: x })))),
              h("tbody", {}, st.days.map((d) => h("tr", {}, [d.day, d.visitors, d.views, d.chats, d.ai, d.bookings].map((x) => h("td", { style: "padding:5px 6px;border-bottom:1px solid var(--line)", text: String(x) })))))))) ),
        group("Copy this restaurant",
          h("p", { class: "hint", text: "Makes a new restaurant with the same design, texts, menu, photos and AI knowledge. Save your changes first. The Navira slug, domain and channel IDs start empty in the copy." }),
          h("form", { method: "post", action: `/admin/r/${RID}/copy`, class: "add-line", style: "flex-wrap:wrap" }, h("input", { type: "hidden", name: "csrf", value: CSRF }), cName, cId, h("button", { type: "submit", class: "btn" }, "Make the copy"))),
        group("Export this restaurant",
          h("p", { class: "hint", text: "Downloads one zip with the website, photos, history and AI knowledge (no customer messages). Import it on another Navira Hub under Backups & tools, for example to move a restaurant from your laptop to the server." }),
          h("a", { class: "btn add-btn", href: `/admin/r/${RID}/export` }, "Export as zip"), " ",
          h("a", { class: "btn quiet add-btn", href: "/admin/system", text: "Backups & tools →" })),
      ];
    },

    live: () => [
      group("Website address",
        h("p", { class: "hint", text: S.live ? "The website is live at:" : "After you press Publish, the website will be at:" }), copyBox(S.info.live_url),
        field("The restaurant's own domain (optional)", ["domain"], { placeholder: "www.restaurant.co.uk" }),
        h("ol", { class: "steps hint" },
          h("li", { text: "In Render: open this service → Settings → Custom Domains → add the domain." }),
          h("li", { text: "Where the domain was bought: add the DNS record Render shows you." }),
          h("li", { text: "Type the domain above, Save, and wait for Render to say “Verified”." }))),
      group("Privacy notice",
        h("p", { class: "hint", text: "The booking form and the chat collect names, emails and phone numbers, so the website should say what happens to them. Meta also asks for a privacy page before it approves Facebook and Instagram messaging. The text gets its own page, linked at the bottom of the website." }),
        field("Privacy text", ["privacy"], { type: "textarea", rows: 7 }),
        h("button", { type: "button", class: "btn sm add-btn", onclick: () => { if (D.privacy && !confirm("Replace the text that is there?")) return; set(["privacy"], `${D.name} privacy notice\n\nWhen you book a table, order, or write to us in the chat on this website, on Facebook or on Instagram, we collect the details you give us: your name, email address, phone number, booking details and messages.\n\nWe use them only to handle your booking, order or question. Bookings are stored in our booking system, provided by Navira Technology. Messages in our chat are answered by an AI assistant and by our staff, and are deleted after ${30} days.\n\nWe do not sell your details or use them for advertising without asking you first.\n\nYou can ask us for a copy of your details, or ask us to correct or delete them, at any time: ${D.contact.email || "[email]"}${D.contact.phone ? " or " + D.contact.phone : ""}.\n\n${D.name}, ${D.contact.address || "[address]"}`); render(); } }, "Write a starting text for me"),
        h("p", { class: "hint", text: "This starting text is a simple example, not legal advice. Check it matches what the restaurant really does before publishing." })),
      group("Cookie notice",
        h("p", { class: "hint", text: "A small bar at the bottom of the website, shown once to each visitor until they press OK. It links to the privacy page if there is one." }),
        field("Show the notice on the website", ["cookies", "enabled"], { type: "checkbox" }),
        field("Text (optional)", ["cookies", "text"], { type: "textarea", rows: 3, max: 300, placeholder: S.info.cookie_default, hint: "Leave empty to use the text shown in grey. Change it if the restaurant adds things like Google Analytics or a Facebook pixel through custom code: those need real consent, which this simple notice does not collect." })),
      group("History (undo)",
        S.versions.length ? h("ul", { class: "history" }, S.versions.map((v) => h("li", {}, h("span", {}, h("strong", { text: v.when }), " · " + (v.note || "Edited")),
          h("button", { type: "button", class: "btn sm", onclick: () => restore(v) }, "Go back to before this")))) : h("p", { class: "muted", text: "No earlier versions yet. Every save is kept here so you can undo it." })),
      (() => {
        const box = h("input", { type: "checkbox", checked: !S.offline, onchange: async () => {
          try { const r = await api("/online", { json: { on: box.checked } }); S.offline = r.offline; toast(r.offline ? "Website switched off. The link no longer works." : "Website switched on again."); paintChrome(); render(); }
          catch (e) { box.checked = !box.checked; toast(e.message, true); }
        } });
        const word = h("input", { type: "text", placeholder: "delete", autocomplete: "off", "aria-label": "Type delete to confirm", style: "max-width:200px", oninput: () => { btn.disabled = word.value.trim().toLowerCase() !== "delete"; } });
        const btn = h("button", { type: "button", class: "btn danger", disabled: true, onclick: () => removeRestaurant(word.value) }, "Delete restaurant");
        return h("div", { class: "group danger-zone" }, h("h3", { text: "Switch off or delete this restaurant" }),
          h("h3", { text: "Switch the website off" }),
          h("label", { class: "switch" }, box, h("span", { class: "track" }), h("span", { class: "lbl", text: S.offline ? "Website is OFF" : "Website is on" })),
          h("p", { class: "hint", text: S.offline ? "OFF now: anyone who opens the website link sees “This website is not available right now”. Nothing is deleted; switch it on to bring it back." : "Switch this off to take the website down without deleting anything. The link then shows “not available”, and you can switch it back on any time." + (S.live ? "" : " (The website is not published yet.)") }),
          h("h3", { text: "Delete for good" }),
          h("p", { class: "hint", text: "Removes the restaurant and its website from the dashboard. To make the button work, type the word delete in the box." }),
          h("div", { class: "add-line" }, word, btn));
      })(),
    ],
  };

  /* put fields side by side, two per row */
  function pairs(fields) {
    const out = [];
    for (let n = 0; n < fields.length; n += 2) out.push(h("div", { class: "two" }, fields[n], fields[n + 1] || h("div", {})));
    return out;
  }

  function copyBox(text) {
    const btn = h("button", { type: "button", class: "btn sm", onclick: async () => { try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; setTimeout(() => (btn.textContent = "Copy"), 1500); } catch (_) { toast("Select the text and copy it by hand.", true); } } }, "Copy");
    return h("div", { class: "copy-box" }, h("code", { text: text }), btn);
  }

  function render() {
    const side = $("#sideNav");
    side.replaceChildren(...MENU.map((m) => m.head ? h("p", { class: "side-head", text: m.head })
      : m.href ? h("a", { class: "side-link", href: m.href, text: m.label })
        : h("button", { type: "button", class: "side-link" + (m.id === tab ? " on" : ""), "aria-current": m.id === tab ? "page" : null, onclick: () => { tab = m.id; document.body.classList.remove("side-open"); render(); document.querySelector(".panel").scrollTop = 0; } }, (m.icon ? m.icon + " " : "") + m.label)));
    const m = item();
    $("#panelTitle").textContent = m.label;
    const panel = document.querySelector(".panel"), y = panel.scrollTop;
    const ai = tab === "ai";
    panel.classList.toggle("chat-mode", ai);
    $("#chatPane").hidden = !ai; $("#tab").hidden = ai;
    if (ai) { $("#tab").replaceChildren(); renderChat(); return; }
    $("#tab").replaceChildren(...build(m));
    panel.scrollTop = y;
  }
  $("#sideBtn").addEventListener("click", () => {
    if (window.innerWidth > 1200) document.body.classList.toggle("side-closed"); else document.body.classList.toggle("side-open");
    fitPreview && setTimeout(fitPreview, 50);
  });
  $("#sideScrim").addEventListener("click", () => document.body.classList.remove("side-open"));

  /* ---------- actions ---------- */
  async function save(quiet) {
    const btn = $("#saveBtn"); btn.disabled = true;
    try { apply(await api("/save", { json: { data: D } })); render(); reloadPreview(); if (!quiet) toast("Saved. Press Publish to make it live."); return true; }
    catch (e) { toast(e.message, true); return false; }
    finally { btn.disabled = false; }
  }
  async function publish() {
    if (dirty && !(await save(true))) return;
    try { apply(await api("/publish")); render(); toast("Published. The website is live."); }
    catch (e) { toast(e.message, true); }
  }
  async function upload(files) {
    if (!files || !files.length) return;
    const fd = new FormData(); [...files].forEach((f) => fd.append("files", f));
    toast("Uploading…");
    try { const j = await api("/photos", { body: fd }); apply(j, true); render(); toast(j.problems.length ? j.problems.join(" · ") : `${j.saved.length} photo${j.saved.length === 1 ? "" : "s"} added`, j.problems.length > 0); }
    catch (e) { toast(e.message, true); }
  }
  async function removePhoto(p) {
    if (!confirm(`Delete the photo "${p}"? This cannot be undone.`)) return;
    try {
      const j = await api("/photos/delete", { json: { name: p } });
      const ref = "photos/" + p;
      ["logo", "hero_image", "about_image"].forEach((k) => { if (D[k] === ref) { D[k] = ""; dirty = true; } });
      if (D.gallery.includes(ref)) { D.gallery = D.gallery.filter((g) => g !== ref); dirty = true; }
      D.features.forEach((f) => { if (f.image === ref) { f.image = ""; dirty = true; } });
      apply(j, true); render();
      if (dirty) toast("Photo deleted. Press Save to update the website.");
    } catch (e) { toast(e.message, true); }
  }
  async function restore(v) {
    if (dirty && !confirm("You have unsaved changes. Going back will lose them. Continue?")) return;
    if (!confirm(`Go back to how the website was before "${v.note || "this change"}" (${v.when})?`)) return;
    try { apply(await api("/restore", { json: { version: v.id } })); render(); reloadPreview(); toast("Restored. Check the preview, then Publish."); }
    catch (e) { toast(e.message, true); }
  }

  async function addKnowledge(o) {
    const fd = new FormData();
    if (o.files) [...o.files].forEach((f) => fd.append("files", f));
    if (o.url) fd.append("url", o.url);
    if (o.note) { fd.append("note", o.note); fd.append("title", o.title || ""); }
    toast(o.files ? "Reading… this can take up to a minute." : "Adding…");
    try { const j = await api("/knowledge", { body: fd }); apply(j, true); render(); toast(j.problems.length ? j.problems.join(" · ") : "Added. The assistant can use it now.", j.problems.length > 0); }
    catch (e) { toast(e.message, true); }
  }
  async function removeKnowledge(x) {
    if (!confirm(`Remove "${x.title}"? The assistant will stop using it.`)) return;
    try { apply(await api("/knowledge/delete", { json: { id: x.id } }), true); render(); } catch (e) { toast(e.message, true); }
  }
  async function removeRestaurant(typed) {
    try { await api("/delete", { json: { confirm: typed } }); dirty = false; location.href = "/admin"; } catch (e) { toast(e.message, true); }
  }

  /* ---------- Build with AI (chat) ---------- */
  const chatLog = $("#chatLog"), chatText = $("#chatText"), chatFile = $("#chatFile");
  let pending = [], busy = false;
  function rich(text) {            // **bold** only, everything else stays plain text
    const span = document.createElement("span");
    String(text).split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) span.append(h("strong", { text: part.slice(2, -2) })); else span.append(part);
    });
    return span;
  }
  function bubble(turn) {
    const me = turn.role === "user";
    return h("div", { class: "bubble " + (me ? "me" : "ai") }, rich(turn.text),
      me && turn.files && turn.files.length ? h("div", { class: "files", text: "📎 " + turn.files.join(", ") }) : null,
      !me && turn.changes && turn.changes.length ? h("ul", { class: "done" }, turn.changes.slice(0, 10).map((c) => h("li", { text: c })), turn.changes.length > 10 ? h("li", { text: `and ${turn.changes.length - 10} more` }) : null) : null);
  }
  function renderChat() {
    const turns = S.conversation || [];
    const fresh = !D.menu.length && !D.contact.phone;
    const hello = fresh
      ? `Hi! Let's build the website for **${D.name}**.\n\nThe fastest way: send me a link to the restaurant's current website or Facebook page, or attach the menu (photo or PDF) and some photos. I'll fill in everything I can and ask you for what's missing.\n\nOr just tell me about the restaurant: what food, the address, phone and opening hours.`
      : `Hi! What would you like to change on **${D.name}**?\n\nYou can type it in your own words, attach a new menu or photos, or give me a link to read.`;
    chatLog.replaceChildren(bubble({ role: "assistant", text: hello }), ...turns.map(bubble));
    const ideas = turns.length ? [] : fresh
      ? ["Here is the old website link: ", "I'll attach the menu and photos", "Let me tell you about the restaurant: "]
      : ["Change the opening hours: ", "Add an offer: ", "Change a price: ", "Write a better welcome text"];
    $("#chatSuggest").replaceChildren(...ideas.map((t) => h("button", { type: "button", onclick: () => { chatText.value = t; chatText.focus(); } }, t.replace(/: $/, ""))));
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function paintFiles() {
    $("#chatFiles").replaceChildren(...pending.map((f, i) => h("span", {}, f.name, h("button", { type: "button", "aria-label": "Remove " + f.name, onclick: () => { pending.splice(i, 1); paintFiles(); } }, "✕"))));
  }
  chatFile.addEventListener("change", () => { pending = pending.concat([...chatFile.files]).slice(0, 12); chatFile.value = ""; paintFiles(); });
  chatText.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chatForm").requestSubmit(); } });
  chatText.addEventListener("input", () => { chatText.style.height = "auto"; chatText.style.height = Math.min(160, chatText.scrollHeight) + "px"; });
  $("#chatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatText.value.trim();
    if (busy || (!text && !pending.length)) return;
    if (dirty && !(await save(true))) return;
    busy = true;
    const btn = $("#chatBtn"); btn.disabled = true;
    const fd = new FormData(); fd.append("message", text); pending.forEach((f) => fd.append("files", f));
    $("#chatSuggest").replaceChildren();
    chatLog.append(bubble({ role: "user", text: text || "(files)", files: pending.map((f) => f.name) }));
    const wait = h("div", { class: "bubble ai typing", text: pending.length ? "Reading your files and working on it… this can take a minute." : "Working on it…" });
    chatLog.append(wait); chatLog.scrollTop = chatLog.scrollHeight;
    try {
      const j = await api("/chat", { body: fd });
      chatText.value = ""; chatText.style.height = "auto"; pending = []; paintFiles();
      apply(j); render();
      if (j.changes.length) reloadPreview();
      if (j.problems.length) toast(j.problems.join(" · "), true);
    } catch (err) {
      wait.className = "bubble ai"; wait.style.borderColor = "#f5c6c0"; wait.textContent = err.message;
    } finally { busy = false; btn.disabled = false; chatText.focus(); }
  });
  $("#chatReset").addEventListener("click", async () => {
    if (!(S.conversation || []).length || !confirm("Clear this conversation? The website itself is not changed.")) return;
    try { apply(await api("/chat/reset"), true); render(); } catch (e) { toast(e.message, true); }
  });

  $("#saveBtn").addEventListener("click", () => save());
  $("#discardBtn").addEventListener("click", () => { if (confirm("Throw away the changes you have not saved?")) { apply(S); render(); } });
  $("#publishBtn").addEventListener("click", publish);
  document.querySelectorAll("[data-device]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-device]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    document.querySelector(".frame-wrap").classList.toggle("mobile", b.dataset.device === "mobile");
    document.querySelector(".frame-wrap").style.justifyContent = "center"; fitPreview();
  }));
  /* Desktop preview: show the real desktop layout, scaled down to fit */
  function fitPreview() {
    const wrap = document.querySelector(".frame-wrap"), f = $("#frame");
    if (wrap.classList.contains("mobile") || window.innerWidth <= 980) { f.style.cssText = ""; return; }
    const w = wrap.clientWidth - 28, hgt = wrap.clientHeight - 28, scale = Math.min(1, w / 1280);
    f.style.cssText = `width:1280px;height:${hgt / scale}px;transform:scale(${scale});transform-origin:top left;flex:none;transition:none`;
    wrap.style.justifyContent = scale < 1 ? "flex-start" : "center";
  }
  window.addEventListener("resize", fitPreview);
  fitPreview();
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  api("/data", { method: "GET" }).then((j) => { apply(j); render(); }).catch((e) => toast(e.message, true));
})();
