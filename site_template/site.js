/* Navira restaurant website: open/closed status, menu filter, gallery */
(function () {
  "use strict";
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => [...(c || document).querySelectorAll(s)];

  /* Open now / closed (UK time) */
  const HOURS = window.SITE_HOURS || [];
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const t12 = (t) => { const [h, m] = t.split(":").map(Number); return (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h >= 12 ? "pm" : "am"); };
  function ukNow() {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    const g = (t) => (p.find((x) => x.type === t) || {}).value;
    return { day: g("weekday"), mins: (+g("hour") % 24) * 60 + +g("minute") };
  }
  function status() {
    if (!HOURS.length) return;
    const n = ukNow();
    const i = HOURS.findIndex((h) => h[0] === n.day);
    $$(".hours li").forEach((li) => li.classList.toggle("today", li.dataset.day === n.day));
    const els = $$("[data-status]");
    if (!els.length || i < 0) return;
    const [, o, c] = HOURS[i];
    let txt, open = false;
    if (o && n.mins >= toMin(o) && n.mins < toMin(c)) { open = true; txt = "Open now · until " + t12(c); }
    else if (o && n.mins < toMin(o)) txt = "Closed · opens today at " + t12(o);
    else {
      for (let k = 1; k <= 7; k++) {
        const nx = HOURS[(i + k) % HOURS.length];
        if (nx[1]) { txt = "Closed · opens " + (k === 1 ? "tomorrow" : nx[0]) + " at " + t12(nx[1]); break; }
      }
    }
    els.forEach((el) => { el.classList.toggle("open", open); $(".txt", el).textContent = txt || ""; });
  }
  status(); setInterval(status, 60000);

  /* Menu: category buttons + search */
  const cats = $$(".cat"), groups = $$(".mcat"), search = $(".search"), empty = $(".empty");
  let cat = "all";
  function filter() {
    const q = (search && search.value.trim().toLowerCase()) || "";
    let shown = 0;
    groups.forEach((g) => {
      let n = 0;
      $$(".dish", g).forEach((d) => { const ok = !q || d.dataset.text.includes(q); d.hidden = !ok; if (ok) n++; });
      const vis = n > 0 && (q || cat === "all" || g.dataset.cat === cat);
      g.hidden = !vis; if (vis) shown += n;
    });
    if (empty) empty.hidden = shown > 0;
  }
  cats.forEach((b) => b.addEventListener("click", () => {
    cat = b.dataset.cat; if (search) search.value = "";
    cats.forEach((x) => x.setAttribute("aria-pressed", x === b));
    filter();
    closeCats(b.textContent);
    const m = $("#menu"); if (m && m.getBoundingClientRect().top < 0) m.scrollIntoView();
  }));
  if (search) search.addEventListener("input", filter);

  /* Menu sections as a ☰ button that opens a list (Design -> Food menu -> section buttons) */
  const catsBtn = $(".cats-toggle"), catsBox = $(".cats");
  function closeCats(label) {
    if (!catsBtn) return;
    catsBox.classList.remove("open"); catsBtn.setAttribute("aria-expanded", "false");
    if (label) $(".cats-now", catsBtn).textContent = label === "All" ? "All sections" : label;
  }
  if (catsBtn) {
    catsBtn.addEventListener("click", () => { const open = catsBox.classList.toggle("open"); catsBtn.setAttribute("aria-expanded", String(open)); });
    document.addEventListener("click", (e) => { if (!e.target.closest(".cats-wrap")) closeCats(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCats(); });
  }

  /* Menu layout "Sections open when tapped" */
  if ($(".menu.lay-accordion")) $$(".menu.lay-accordion .mcat-head").forEach((hd, i) => {
    const g = hd.parentElement;
    if (i > 0) g.classList.add("shut");
    hd.setAttribute("role", "button"); hd.tabIndex = 0;
    const flip = () => g.classList.toggle("shut");
    hd.addEventListener("click", flip);
    hd.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
  });

  /* Menu sections row: arrows, drag with the mouse, mouse wheel, and touch swipe */
  const row = $(".cats"), wrapEl = $(".cats-wrap");
  if (row && wrapEl && !catsBtn) {
    const prev = $(".cats-arrow.prev", wrapEl), next = $(".cats-arrow.next", wrapEl);
    const sync = () => {
      const max = row.scrollWidth - row.clientWidth, x = row.scrollLeft;
      const left = x > 4, right = x < max - 4;
      prev.hidden = !left; next.hidden = !right;
      wrapEl.classList.toggle("more-left", left); wrapEl.classList.toggle("more-right", right);
    };
    const step = (dir) => row.scrollBy({ left: dir * Math.max(160, row.clientWidth * 0.7), behavior: "smooth" });
    prev.addEventListener("click", () => step(-1));
    next.addEventListener("click", () => step(1));
    row.addEventListener("scroll", sync, { passive: true });
    addEventListener("resize", sync);
    row.addEventListener("wheel", (e) => {                 // an ordinary mouse wheel moves the row sideways
      if (row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const max = row.scrollWidth - row.clientWidth;
      if ((e.deltaY < 0 && row.scrollLeft <= 0) || (e.deltaY > 0 && row.scrollLeft >= max - 1)) return;
      e.preventDefault(); row.scrollLeft += e.deltaY;
    }, { passive: false });
    let down = false, startX = 0, startLeft = 0, moved = false;
    row.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" || e.button !== 0) return; down = true; moved = false; startX = e.clientX; startLeft = row.scrollLeft; });
    addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 6) { moved = true; row.classList.add("dragging"); }
      if (moved) row.scrollLeft = startLeft - dx;
    });
    addEventListener("pointerup", () => { if (!down) return; down = false; setTimeout(() => row.classList.remove("dragging"), 0); });
    row.addEventListener("click", (e) => {                 // a drag is not a click; a click also brings the button into view
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; return; }
      const b = e.target.closest(".cat"); if (!b) return;
      const r = b.getBoundingClientRect(), box = row.getBoundingClientRect();
      row.scrollBy({ left: r.left + r.width / 2 - (box.left + box.width / 2), behavior: "smooth" });
    }, true);
    sync(); setTimeout(sync, 600);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync);
  }

  /* Offers take turns in the chip at the top (every 5 seconds) */
  const chip = $(".offer-chip[data-offers]");
  if (chip) {
    let offers = [];
    try { offers = JSON.parse(chip.dataset.offers).filter((o) => o && (o.title || o.text)); } catch (_) {}
    if (offers.length > 1) {
      const tag = $("span", chip), txt = $("em", chip);
      let k = 0, hold = false;
      chip.addEventListener("mouseenter", () => (hold = true)); chip.addEventListener("mouseleave", () => (hold = false));
      chip.addEventListener("focus", () => (hold = true)); chip.addEventListener("blur", () => (hold = false));
      setInterval(() => {
        if (hold || document.hidden) return;
        chip.classList.add("swap");
        setTimeout(() => { k = (k + 1) % offers.length; tag.textContent = offers[k].title || "Offer"; txt.textContent = offers[k].text || ""; chip.classList.remove("swap"); }, 350);
      }, 5000);
    }
  }

  /* Gallery: tap a photo to open it big, then slide (swipe, arrows or the keyboard) to the next one */
  const lb = $(".lightbox");
  if (lb) {
    const img = $("img", lb), count = $(".lb-count", lb), shots = $$(".gallery .g");
    let at = 0;
    const show = (i) => {
      at = (i + shots.length) % shots.length;
      img.classList.remove("in"); void img.offsetWidth;
      img.src = shots[at].dataset.src; img.classList.add("in");
      if (count) count.textContent = shots.length > 1 ? `${at + 1} / ${shots.length}` : "";
    };
    const close = () => { lb.hidden = true; document.body.style.overflow = ""; };
    shots.forEach((g, i) => g.addEventListener("click", () => { lb.hidden = false; document.body.style.overflow = "hidden"; show(i); }));
    lb.classList.toggle("one", shots.length < 2);
    $(".lb-prev", lb).addEventListener("click", (e) => { e.stopPropagation(); show(at - 1); });
    $(".lb-next", lb).addEventListener("click", (e) => { e.stopPropagation(); show(at + 1); });
    lb.addEventListener("click", (e) => { if (e.target === lb || e.target.closest(".lb-x")) close(); });
    document.addEventListener("keydown", (e) => {
      if (lb.hidden) return;
      if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") show(at - 1); else if (e.key === "ArrowRight") show(at + 1);
    });
    let x0 = null;
    lb.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) show(at + (dx < 0 ? 1 : -1));
    });
  }

  /* Things that slide sideways: reviews, gallery slider, offers and feature sliders.
     Arrows move one card; with data-autoslide the row also moves by itself every few seconds. */
  $$(".slide-wrap").forEach((wrap) => {
    const row = $(".rev-grid, .grid", wrap); if (!row) return;
    const prev = $(".slide-arrow.prev", wrap), next = $(".slide-arrow.next", wrap);
    const stepBy = () => { const c = row.firstElementChild; return c ? c.getBoundingClientRect().width + parseFloat(getComputedStyle(row).columnGap || 0) : row.clientWidth; };
    const go = (dir) => {
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 4) return;
      if (dir > 0 && row.scrollLeft >= max - 4) row.scrollTo({ left: 0, behavior: "smooth" });
      else if (dir < 0 && row.scrollLeft <= 4) row.scrollTo({ left: max, behavior: "smooth" });
      else row.scrollBy({ left: dir * stepBy(), behavior: "smooth" });
    };
    if (prev) prev.addEventListener("click", () => go(-1));
    if (next) next.addEventListener("click", () => go(1));
    const every = parseInt(row.dataset.autoslide || "0", 10);
    if (every && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      let hold = false, seen = false;
      ["mouseenter", "focusin", "touchstart", "pointerdown"].forEach((ev) => wrap.addEventListener(ev, () => (hold = true), { passive: true }));
      ["mouseleave", "focusout"].forEach((ev) => wrap.addEventListener(ev, () => (hold = false)));
      wrap.addEventListener("touchend", () => setTimeout(() => (hold = false), 4000), { passive: true });
      if ("IntersectionObserver" in window) new IntersectionObserver((en) => (seen = en[0].isIntersecting), { threshold: 0.3 }).observe(wrap); else seen = true;
      setInterval(() => { if (!hold && seen && !document.hidden) go(1); }, every);
    }
  });

  /* Phone menu (the ☰ button) */
  const burger = $(".burger"), drawer = $("#drawer"), nav = $(".nav");
  if (burger && drawer) {
    const place = () => { const r = nav.getBoundingClientRect(); drawer.style.setProperty("--drawer-top", Math.max(0, r.bottom) + "px"); };
    const setOpen = (on) => {
      if (on) place();
      burger.setAttribute("aria-expanded", String(on));
      burger.setAttribute("aria-label", on ? "Close menu" : "Open menu");
      drawer.classList.toggle("open", on); drawer.setAttribute("aria-hidden", String(!on));
      document.body.classList.toggle("locked", on);
    };
    burger.addEventListener("click", () => setOpen(burger.getAttribute("aria-expanded") !== "true"));
    drawer.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
    addEventListener("resize", () => { if (innerWidth > 960) setOpen(false); });
  }
  /* height of the festive banner, so a see-through menu bar can sit under it */
  const bar = $(".fest-bar"); if (bar) document.documentElement.style.setProperty("--bar-h", bar.offsetHeight + "px");

  /* Movement: sections fade in as they scroll into view */
  document.documentElement.classList.add("js"); document.body.classList.add("js");
  const reveals = $$("[data-reveal]");
  if (document.body.classList.contains("motion-none") || !("IntersectionObserver" in window)) reveals.forEach((el) => el.classList.add("in"));
  else {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el, i) => { if (el.matches(".feature, blockquote")) el.style.setProperty("--d", (i % 3) * 90 + "ms"); io.observe(el); });
    setTimeout(() => reveals.forEach((el) => el.classList.add("in")), 6000);     // never leave anything hidden
  }

  /* ---------- Table booking (goes into the Navira booking system) ---------- */
  const BK = window.SITE_BOOKING;
  if (BK) {
    const api = "/api/booking/" + encodeURIComponent(BK.rid);
    const pad = (n) => String(n).padStart(2, "0");
    const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    const parse = (v) => { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d); };
    const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const nice = (v) => parse(v).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const S = { step: 1, party: 2, date: iso(today()), time: "", times: null, loading: false, timesErr: "", name: "", email: "", phone: "", note: "", errors: {}, sending: false, fail: "", done: null, max: BK.max, paused: false };
    let root = null, seq = 0;

    /* The booking form, in order:  1 date  ->  2 guests  ->  3 time  ->  your details  ->  check  ->  booked */
    const STEPS = ["Date, guests & time", "Your details", "Check & confirm"];
    const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
    S.month = monthStart(today());
    function calendar() {
      const t0 = today(), last = addDays(t0, BK.days), m = S.month;
      const first = new Date(m.getFullYear(), m.getMonth(), 1), days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      const lead = (first.getDay() + 6) % 7;                         // weeks start on Monday
      let cells = "";
      for (let i = 0; i < lead; i++) cells += "<span></span>";
      for (let n = 1; n <= days; n++) {
        const d = new Date(m.getFullYear(), m.getMonth(), n), v = iso(d), off = d < t0 || d > last;
        cells += `<button type="button" class="bk-cal-day${+d === +t0 ? " today" : ""}" data-date="${v}" aria-pressed="${S.date === v}" ${off ? "disabled" : ""} aria-label="${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}">${n}</button>`;
      }
      const canPrev = monthStart(t0) < m, canNext = new Date(m.getFullYear(), m.getMonth() + 1, 1) <= last;
      return `<div class="bk-cal"><div class="bk-cal-head"><button type="button" data-a="pm" aria-label="Earlier month" ${canPrev ? "" : "disabled"}>‹</button><strong>${m.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</strong><button type="button" data-a="nm" aria-label="Later month" ${canNext ? "" : "disabled"}>›</button></div>
        <div class="bk-cal-week">${["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((x) => `<span>${x}</span>`).join("")}</div><div class="bk-cal-grid">${cells}</div></div>`;
    }
    const row = (k, v) => `<div><span>${k}</span><strong>${v}</strong></div>`;
    const calLink = () => {
      const st = parse(S.done.date), [hh, mm] = S.done.time.split(":").map(Number); st.setHours(hh, mm);
      const en = new Date(st.getTime() + 2 * 3600e3), f = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "T" + pad(d.getHours()) + pad(d.getMinutes()) + "00";
      return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent("Table at " + BK.name) + "&dates=" + f(st) + "/" + f(en) + "&ctz=Europe/London&location=" + encodeURIComponent(BK.address || BK.name) + "&details=" + encodeURIComponent("Table for " + S.done.party_size + ". Reference " + S.done.reference + (BK.phone ? ". " + BK.phone : ""));
    };
    const telLink = () => BK.phone ? ` on <a href="tel:${esc(BK.phone.replace(/[^\d+]/g, ""))}"><strong>${esc(BK.phone)}</strong></a>` : "";
    const privLine = () => `<p class="bk-privacy">Your details are sent to ${esc(BK.name || "the restaurant")} to make this booking.${BK.privacy ? ` <a href="${esc(BK.privacy)}" target="_blank" rel="noopener">Privacy notice</a>` : ""}</p>`;
    const maxNote = () => S.party >= S.max ? `<p class="bk-note bk-max"><strong>${S.max} is the most we can book online.</strong> For a bigger group, please contact the restaurant directly${telLink()}.</p>` : "";
    const side = () => `<aside class="bk-side"><p class="bk-side-h">Your booking</p><h3>${esc(BK.name)}</h3>
        <dl><div><dt>Date</dt><dd>${esc(nice(S.date))}</dd></div><div><dt>Guests</dt><dd>${S.party}</dd></div><div><dt>Time</dt><dd>${S.time ? t12(S.time.slice(0, 5)) : "—"}</dd></div>${S.name ? `<div><dt>Name</dt><dd>${esc(S.name)}</dd></div>` : ""}</dl>
        ${BK.address ? `<p class="bk-side-a">${esc(BK.address)}</p>` : ""}${BK.phone ? `<p class="bk-side-a">Prefer to talk? ${esc(BK.phone)}</p>` : ""}</aside>`;
    const view = () => {
      const html = inner();
      return BK.style === "full" && !S.done && !S.paused ? `<div class="bk-cols"><div class="bk-main">${html}</div>${side()}</div>` : html;
    };
    function quick() {             /* everything on one screen */
      const t0 = today(), days = [];
      for (let i = 0; i < 14 && i <= BK.days; i++) days.push(addDays(t0, i));
      let slots;
      if (S.loading) slots = `<p class="bk-note"><span class="bk-spin"></span> Checking free tables…</p>`;
      else if (S.timesErr) slots = `<p class="bk-note">${esc(S.timesErr)} <button class="btn" type="button" data-a="retry" style="margin-top:10px">Try again</button></p>`;
      else if (S.times && !S.times.length) slots = `<p class="bk-note">No tables left for ${S.party} on ${esc(nice(S.date))}. Try another day or a smaller group.</p>`;
      else slots = `<div class="bk-slots" role="group" aria-label="Free times">${(S.times || []).map((t) => `<button class="bk-slot" type="button" data-time="${esc(t)}" aria-pressed="${S.time === t}">${t12(t.slice(0, 5))}</button>`).join("")}</div>`;
      const f = (k, label, type, ph, auto, extra) => `<div class="bk-field${S.errors[k] ? " bad" : ""}"><label for="bk-${k}">${label}</label><input id="bk-${k}" data-f="${k}" type="${type}" placeholder="${ph}" autocomplete="${auto}" value="${esc(S[k])}" ${extra || ""}>${S.errors[k] ? `<span class="err">${esc(S.errors[k])}</span>` : ""}</div>`;
      const opts = []; for (let n = 1; n <= S.max; n++) opts.push(`<option value="${n}" ${n === S.party ? "selected" : ""}>${n} ${n === 1 ? "person" : "people"}</option>`);
      return `<h2>Book a table</h2><p class="bk-sub">${esc(BK.name)}</p>
        <div class="bk-label"><span><b>1</b> Date</span><span>${esc(nice(S.date))}</span></div>
        ${S.showCal ? calendar() : `<div class="bk-days">${days.map((d) => `<button class="bk-day" type="button" data-date="${iso(d)}" aria-pressed="${S.date === iso(d)}"><small>${+d === +t0 ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short" })}</small><b>${d.getDate()}</b><small>${d.toLocaleDateString("en-GB", { month: "short" })}</small></button>`).join("")}</div><button type="button" class="bk-more" data-a="cal">Another date…</button>`}
        <div class="bk-label"><span><b>2</b> People</span><span>Up to ${S.max} online</span></div>
        <select class="bk-select" data-f="party" aria-label="Number of people">${opts.join("")}</select>${maxNote()}
        <div class="bk-label"><span><b>3</b> Time</span><span>${S.time ? t12(S.time.slice(0, 5)) : ""}</span></div>${slots}
        <div class="bk-label"><span><b>4</b> Your details</span><span></span></div>
        <div class="bk-two">${f("name", "Full name", "text", "Your name", "name", 'maxlength="50"')}${f("phone", "Phone", "tel", "07700 900000", "tel", 'inputmode="tel"')}</div>
        ${f("email", "Email (for your confirmation)", "email", "you@example.com", "email")}
        <div class="bk-field"><label for="bk-note">Special requests (optional)</label><textarea id="bk-note" data-f="note" rows="2" maxlength="200" placeholder="Allergies, high chair, birthday…">${esc(S.note)}</textarea></div>${privLine()}
        ${S.fail ? `<div class="bk-alert" role="alert"><strong>Not booked yet.</strong> ${esc(S.fail)}</div>` : ""}
        <div class="bk-actions"><button class="btn solid" type="button" data-a="quick" ${S.time && !S.sending ? "" : "disabled"}>${S.sending ? '<span class="bk-spin"></span> Booking…' : S.time ? "Book for " + esc(nice(S.date)) + ", " + t12(S.time.slice(0, 5)) : "Choose a time to book"}</button></div>`;
    }
    const inner = () => {
      if (S.done) return `<div class="bk-done" role="status"><div class="tick">✓</div><h2 style="margin:0 0 6px">You're booked${S.name ? ", " + esc(S.name.split(" ")[0]) : ""}!</h2>
        <p class="bk-sub">A confirmation email is on its way to ${esc(S.done.email)}.</p>
        <div class="bk-ref"><small>Booking reference</small>${esc(S.done.reference)}</div>
        <div class="bk-review bk-all">${row("Restaurant", esc(BK.name))}${row("Date", esc(nice(S.done.date)))}${row("Time", t12(S.done.time))}${row("Guests", S.done.party_size)}${row("Name", esc(S.name))}${row("Email", esc(S.done.email))}${row("Phone", esc(S.phone))}${S.note ? row("Special requests", esc(S.note)) : ""}${BK.address ? row("Address", esc(BK.address)) : ""}${BK.phone ? row("Need to change it?", "Call " + esc(BK.phone)) : ""}</div>
        <div class="bk-actions"><a class="btn ghost" href="${calLink()}" target="_blank" rel="noopener">Add to calendar</a><button class="btn ghost" type="button" data-a="print">Print</button><button class="btn solid" type="button" data-a="close">Done</button></div></div>`;
      if (S.paused) return `<h2>Book a table</h2><p class="bk-note">Online booking is paused right now. Please contact the restaurant directly${telLink()}.</p>`;
      if (BK.style === "quick") return quick();
      const head = `<h2>Book a table</h2><p class="bk-sub">${esc(BK.name)}</p><ol class="bk-steps named" aria-label="Step ${S.step} of 3">${STEPS.map((t, n) => `<li class="${n + 1 < S.step ? "on done" : n + 1 === S.step ? "on now" : ""}"><i>${n + 1 < S.step ? "✓" : n + 1}</i><span>${t}</span></li>`).join("")}</ol>`;
      const sum = `<div class="bk-sum"><span>📅 ${esc(nice(S.date))}</span><span>👥 ${S.party} guest${S.party === 1 ? "" : "s"}</span>${S.time ? `<span>🕖 ${t12(S.time.slice(0, 5))}</span>` : ""}</div>`;
      if (S.step === 1) {
        let slots;
        if (S.loading) slots = `<p class="bk-note"><span class="bk-spin"></span> Checking free tables…</p>`;
        else if (S.timesErr) slots = `<p class="bk-note">${esc(S.timesErr)} <button class="btn" type="button" data-a="retry" style="margin-top:10px">Try again</button></p>`;
        else if (S.times && !S.times.length) slots = `<p class="bk-note">No tables left for ${S.party} on ${esc(nice(S.date))}. Try another day or a smaller group${BK.phone ? ", or call " + esc(BK.phone) : ""}.</p>`;
        else slots = `<div class="bk-slots" role="group" aria-label="Free times">${(S.times || []).map((t) => `<button class="bk-slot" type="button" data-time="${esc(t)}" aria-pressed="${S.time === t}">${t12(t.slice(0, 5))}</button>`).join("")}</div>`;
        return head + `
          <div class="bk-label"><span><b>1</b> Choose the date</span><span>${esc(nice(S.date))}</span></div>${calendar()}
          <div class="bk-label"><span><b>2</b> How many people?</span><span>Up to ${S.max} online</span></div>
          <div class="bk-stepper"><button type="button" data-a="minus" aria-label="One fewer guest" ${S.party <= 1 ? "disabled" : ""}>−</button><output aria-live="polite">${S.party}</output><button type="button" data-a="plus" aria-label="One more guest" ${S.party >= S.max ? "disabled" : ""}>+</button></div>${maxNote()}
          <div class="bk-label"><span><b>3</b> Pick a time</span><span>${S.time ? t12(S.time.slice(0, 5)) : ""}</span></div>${slots}
          <div class="bk-actions"><button class="btn solid" type="button" data-a="next" ${S.time ? "" : "disabled"}>Continue</button></div>`;
      }
      if (S.step === 2) {
        const f = (k, label, type, ph, auto, extra) => `<div class="bk-field${S.errors[k] ? " bad" : ""}"><label for="bk-${k}">${label}</label><input id="bk-${k}" data-f="${k}" type="${type}" placeholder="${ph}" autocomplete="${auto}" value="${esc(S[k])}" ${extra || ""}>${S.errors[k] ? `<span class="err">${esc(S.errors[k])}</span>` : ""}</div>`;
        return head + sum + `
          ${f("name", "Full name", "text", "Your name", "name", 'maxlength="50"')}${f("email", "Email (for your confirmation)", "email", "you@example.com", "email")}${f("phone", "Phone", "tel", "07700 900000", "tel", 'inputmode="tel"')}
          <div class="bk-field"><label for="bk-note">Special requests (optional)</label><textarea id="bk-note" data-f="note" rows="2" maxlength="200" placeholder="Allergies, high chair, birthday…">${esc(S.note)}</textarea></div>${privLine()}
          <div class="bk-actions"><button class="btn ghost" type="button" data-a="back">Back</button><button class="btn solid" type="button" data-a="review">Review</button></div>`;
      }
      return head + `<p class="bk-sub">Please check everything is right.</p><div class="bk-review">${row("Date", esc(nice(S.date)))}${row("Time", t12(S.time.slice(0, 5)))}${row("Guests", S.party)}${row("Name", esc(S.name))}${row("Email", esc(S.email))}${row("Phone", esc(S.phone))}${S.note ? row("Special requests", esc(S.note)) : ""}</div>
        ${S.fail ? `<div class="bk-alert" role="alert"><strong>Not booked yet.</strong> ${esc(S.fail)}</div>` : ""}
        <div class="bk-actions"><button class="btn ghost" type="button" data-a="back" ${S.sending ? "disabled" : ""}>Back</button><button class="btn solid" type="button" data-a="confirm" ${S.sending ? "disabled" : ""}>${S.sending ? '<span class="bk-spin"></span> Booking…' : "Confirm booking"}</button></div>`;
    };
    const paint = () => { if (root) root.innerHTML = view(); };
    async function loadTimes() {
      const mine = ++seq;
      S.loading = true; S.timesErr = ""; S.time = ""; paint();
      try {
        const r = await fetch(`${api}/times?date=${S.date}&party=${S.party}`); const j = await r.json();
        if (mine !== seq) return;
        if (!j.ok) throw new Error(j.error);
        S.times = j.times;
      } catch (e) { if (mine !== seq) return; S.times = null; S.timesErr = e.message && !/fetch/i.test(e.message) ? e.message : "We couldn't check tables just now."; }
      S.loading = false; paint();
    }
    function check() {
      const e = {}, name = S.name.trim(), phone = S.phone.replace(/\D/g, "").replace(/^44/, "0").replace(/^00/, "0");
      if (!name) e.name = "Please tell us your name."; else if (!/^[a-zA-Z ]+$/.test(name)) e.name = "Letters and spaces only, please.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(S.email.trim())) e.email = "Please enter a valid email address.";
      if (!/^0\d{9,10}$/.test(phone)) e.phone = "Please enter a UK phone number, e.g. 07700 900000.";
      return e;
    }
    async function confirm() {
      S.sending = true; S.fail = ""; paint();
      try {
        const r = await fetch(`${api}/book`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: S.name.trim(), email: S.email.trim(), phone: S.phone, date: S.date, time: S.time, party_size: S.party, note: S.note.trim() }) });
        const j = await r.json();
        if (!j.ok) { S.fail = j.error || "Something went wrong."; if (j.times) { S.times = j.times; } }
        else S.done = j.booking;
      } catch (e) { S.fail = "We couldn't reach the booking system. Your table is NOT booked yet. Please try again" + (BK.phone ? " or call " + BK.phone : "") + "."; }
      S.sending = false; paint();
    }
    function wire(el) {
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.date) { S.date = b.dataset.date; loadTimes(); return; }
        if (b.dataset.party) { S.party = +b.dataset.party; loadTimes(); return; }
        if (b.dataset.time) { S.time = b.dataset.time; paint(); const n = root.querySelector('[data-a="next"]'); if (n) n.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
        switch (b.dataset.a) {
          case "minus": if (S.party > 1) { S.party--; loadTimes(); } break;
          case "plus": if (S.party < S.max) { S.party++; loadTimes(); } break;
          case "retry": loadTimes(); break;
          case "pm": S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); paint(); break;
          case "nm": S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); paint(); break;
          case "print": window.print(); break;
          case "cal": S.showCal = true; paint(); break;
          case "quick": S.errors = check(); if (Object.keys(S.errors).length) { paint(); const f = root.querySelector(".bad input"); if (f) f.focus(); } else confirm(); break;
          case "next": if (S.time) { S.step = 2; paint(); const f = root.querySelector("#bk-name"); if (f) f.focus(); } break;
          case "back": S.step--; S.fail = ""; paint(); break;
          case "review": S.errors = check(); if (Object.keys(S.errors).length) { paint(); const f = root.querySelector(".bad input"); if (f) f.focus(); } else { S.step = 3; paint(); } break;
          case "confirm": confirm(); break;
          case "close": closeBk(); Object.assign(S, { step: 1, done: null, time: "", note: "" }); break;
        }
      });
      el.addEventListener("input", (e) => {
        const k = e.target.dataset.f; if (!k || k === "date" || k === "party") return;
        S[k] = e.target.value;
        if (S.errors[k]) { delete S.errors[k]; const f = e.target.closest(".bk-field"); f.classList.remove("bad"); const m = f.querySelector(".err"); if (m) m.remove(); }
      });
      el.addEventListener("change", (e) => {
        if (e.target.dataset.f === "date" && e.target.value) { S.date = e.target.value; loadTimes(); }
        if (e.target.dataset.f === "party") { S.party = Math.max(1, Math.min(S.max, +e.target.value || 2)); loadTimes(); }
      });
    }
    const modal = $("#bkModal"), popup = $("#bkPopup"), inline = $("#bkInline");
    let lastFocus = null, started = false;
    function start(el) {
      root = el;
      if (!el._wired) { wire(el); el._wired = true; }
      if (!started) { started = true; fetch(`${api}/info`).then((r) => r.json()).then((j) => { if (j.ok) { S.max = Math.min(j.max_party || S.max, 50); S.paused = !!j.paused; if (S.party > S.max) S.party = S.max; paint(); } }).catch(() => {}); loadTimes(); }
      else paint();
    }
    function openBk() {
      if (inline) { inline.scrollIntoView({ behavior: "smooth" }); return; }
      lastFocus = document.activeElement; modal.hidden = false; document.body.classList.add("locked");
      const d = $("#drawer"); if (d && d.classList.contains("open")) { $(".burger").click(); document.body.classList.add("locked"); }
      start(popup); setTimeout(() => $(".bk-x", modal).focus(), 50);
    }
    function closeBk() { if (!modal || modal.hidden) return; modal.hidden = true; document.body.classList.remove("locked"); if (lastFocus) lastFocus.focus(); }
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-book]")) { e.preventDefault(); openBk(); }
      else if (e.target.closest("[data-bk-close]") || e.target === modal) closeBk();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBk(); });
    if (inline) start(inline);
    if (/[?&]book=1/.test(location.search) || location.hash === "#book") openBk();
  }

  /* cookie notice: shown until the visitor presses OK */
  const ck = $("#ckBar");
  if (ck) {
    let seen = false;
    try { seen = localStorage.getItem("ck-ok") === "1"; } catch (_) {}
    if (!seen) ck.hidden = false;
    $("#ckOk").addEventListener("click", () => { ck.hidden = true; try { localStorage.setItem("ck-ok", "1"); } catch (_) {} });
  }

  /* keep the menu bar (logo + ☰) at the top while scrolling, also for the see-through bar over the photo */
  const navEl = $(".nav");
  if (navEl) {
    const mark = () => document.body.classList.toggle("scrolled", window.scrollY > navEl.offsetHeight + 40);
    window.addEventListener("scroll", mark, { passive: true }); mark();
  }

  const y = $("[data-year]"); if (y) y.textContent = new Date().getFullYear();
})();
