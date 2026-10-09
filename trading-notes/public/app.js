/* Trading Notes – frontend */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const CACHE_KEY = "tn_cache_v1";
  const PREFS_KEY = "tn_prefs_v1";
  const COLORS = ["#a855f7", "#8b5cf6", "#6366f1", "#3b82f6", "#06b6d4", "#14b8a6", "#22c55e", "#84cc16", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#94a3b8"];
  const ICON = {
    all: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 4H6l4-4-1-6zM12 14v7"/></svg>',
    img: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>',
    inbox: '<svg viewBox="0 0 24 24"><path d="M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  const state = {
    db: { categories: [], notes: [] },
    filter: "all",          // all | pinned | images | uncat | <categoryId>
    tag: null,
    q: "",
    prefs: { sort: "updated", layout: "grid" },
  };
  try { Object.assign(state.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}")); } catch {}

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const imgUrl = (id) => "/api/images/" + encodeURIComponent(id);
  const catById = (id) => state.db.categories.find((c) => c.id === id);
  const sortedCats = () => [...state.db.categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "pl"));
  const fmtDate = (iso, long) => {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (!long && sameDay) return "dziś " + d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() && !long ? undefined : "numeric" }) +
      (long ? ", " + d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }) : "");
  };
  const plainText = (md) => md.replace(/^#{1,4}\s+/gm, "").replace(/^\s*[-*]\s+\[( |x)\]\s+/gim, "").replace(/^\s*[-*]\s+/gm, "• ").replace(/\*\*|__|\*|`|^>\s?/gm, "").replace(/\n{2,}/g, "\n").trim();
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");

  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch {} }
  function saveCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.db)); } catch {} }

  let toastTimer;
  function toast(msg, err) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (err ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  let busy = 0;
  function setSync(delta, failed) {
    busy = Math.max(0, busy + delta);
    const el = $("#syncState");
    el.className = "sync" + (failed ? " off" : busy ? " busy" : "");
    el.lastChild.textContent = failed ? "Brak połączenia" : busy ? "Zapisywanie…" : "Zsynchronizowano";
  }

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch("/api/" + path, { credentials: "same-origin", ...opts });
    if (res.status === 401) { showLogin(); throw new Error("unauthorized"); }
    if (!res.ok) {
      let msg = "Błąd " + res.status;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }
  const putJSON = (path, body) => api(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  // ---------- logowanie ----------
  function showLogin() {
    $("#app").classList.add("hidden");
    $("#login").classList.remove("hidden");
    setTimeout(() => $("#loginPassword").focus(), 50);
  }
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#loginError").textContent = "";
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: $("#loginPassword").value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Nie udało się zalogować");
      $("#loginPassword").value = "";
      await boot();
    } catch (err) {
      $("#loginError").textContent = err.message;
    } finally { btn.disabled = false; }
  });
  $("#logoutBtn").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    try { localStorage.removeItem(CACHE_KEY); } catch {}
    state.db = { categories: [], notes: [] };
    showLogin();
  });

  async function boot() {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch {}
    if (cached) { state.db = cached; showApp(); }
    try {
      setSync(1);
      state.db = await api("data");
      saveCache();
      setSync(-1);
      showApp();
    } catch (err) {
      setSync(-1, err.message !== "unauthorized");
      if (err.message === "unauthorized") return;
      if (!cached) toast("Nie można połączyć z serwerem", true);
    }
  }
  function showApp() {
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    render();
  }

  // ---------- filtrowanie ----------
  function visibleNotes() {
    const q = norm(state.q.trim());
    let list = state.db.notes.filter((n) => {
      if (state.filter === "pinned" && !n.pinned) return false;
      if (state.filter === "images" && !n.images.length) return false;
      if (state.filter === "uncat" && n.categoryId && catById(n.categoryId)) return false;
      if (!["all", "pinned", "images", "uncat"].includes(state.filter) && n.categoryId !== state.filter) return false;
      if (state.tag && !n.tags.includes(state.tag)) return false;
      if (q) {
        const hay = norm([n.title, n.body, n.tags.join(" "), catById(n.categoryId)?.name || ""].join(" "));
        return q.split(/\s+/).every((w) => hay.includes(w));
      }
      return true;
    });
    const s = state.prefs.sort;
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (s === "title") return (a.title || "").localeCompare(b.title || "", "pl");
      if (s === "created") return b.created.localeCompare(a.created);
      if (s === "oldest") return a.created.localeCompare(b.created);
      return b.updated.localeCompare(a.updated);
    });
    return list;
  }

  function highlight(text) {
    const safe = esc(text);
    const words = state.q.trim().split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length) return safe;
    return safe.replace(new RegExp("(" + words.join("|") + ")", "gi"), "<mark>$1</mark>");
  }

  // ---------- render ----------
  function render() {
    renderSidebar();
    renderNotes();
  }

  function renderSidebar() {
    const notes = state.db.notes;
    const nav = [
      ["all", "Wszystkie notatki", ICON.all, notes.length],
      ["pinned", "Przypięte", ICON.pin, notes.filter((n) => n.pinned).length],
      ["images", "Ze zdjęciami", ICON.img, notes.filter((n) => n.images.length).length],
    ];
    const uncat = notes.filter((n) => !n.categoryId || !catById(n.categoryId)).length;
    if (uncat) nav.push(["uncat", "Bez kategorii", ICON.inbox, uncat]);
    $("#mainNav").innerHTML = nav.map(([id, label, icon, count]) =>
      `<button class="nav-item ${state.filter === id ? "active" : ""}" data-filter="${id}">${icon}<span>${label}</span><span class="count">${count}</span></button>`).join("");

    $("#catList").innerHTML = sortedCats().map((c) => {
      const count = notes.filter((n) => n.categoryId === c.id).length;
      return `<li><div class="cat-item ${state.filter === c.id ? "active" : ""}" data-filter="${esc(c.id)}" role="button" tabindex="0">
        <span class="dot" style="background:${c.color}"></span><span class="name">${esc(c.name)}</span>
        <span class="count">${count}</span><span class="edit" data-edit-cat="${esc(c.id)}" title="Edytuj">${ICON.edit}</span></div></li>`;
    }).join("") || `<li class="muted" style="padding:4px 10px;font-size:13px">Brak kategorii</li>`;

    const tagCounts = {};
    notes.forEach((n) => n.tags.forEach((t) => (tagCounts[t] = (tagCounts[t] || 0) + 1)));
    const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    $("#tagSection").classList.toggle("hidden", !tags.length);
    $("#tagCloud").innerHTML = tags.map(([t]) => `<button class="tag ${state.tag === t ? "active" : ""}" data-tag="${esc(t)}">#${esc(t)}</button>`).join("");
    $("#tagSuggestions").innerHTML = tags.map(([t]) => `<option value="${esc(t)}">`).join("");
  }

  function renderNotes() {
    const list = visibleNotes();
    const f = state.filter;
    const cat = catById(f);
    const titles = { all: "Wszystkie notatki", pinned: "Przypięte", images: "Ze zdjęciami", uncat: "Bez kategorii" };
    $("#viewTitle").innerHTML = cat ? `<span class="dot" style="background:${cat.color}"></span>${esc(cat.name)}` : titles[f] || "Notatki";
    const n = list.length;
    $("#viewMeta").textContent = `${n} ${n === 1 ? "notatka" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "notatki" : "notatek"}` + (state.q ? ` · wyniki dla „${state.q}”` : "");

    const at = $("#activeTag");
    at.classList.toggle("hidden", !state.tag);
    if (state.tag) at.innerHTML = `Filtr tagu: <span class="tag active">#${esc(state.tag)}</span><button class="link-btn" data-clear-tag>wyczyść</button>`;

    const box = $("#notes");
    box.className = "notes " + state.prefs.layout;
    $$("#layoutSeg button").forEach((b) => b.classList.toggle("active", b.dataset.layout === state.prefs.layout));
    $("#sortSelect").value = state.prefs.sort;

    box.innerHTML = list.map(cardHtml).join("");
    const empty = !list.length;
    $("#empty").classList.toggle("hidden", !empty);
    if (empty) {
      const searching = state.q || state.tag;
      $("#emptyTitle").textContent = searching ? "Nic nie znaleziono" : "Brak notatek";
      $("#emptyText").textContent = searching ? "Spróbuj innej frazy albo wyczyść filtry." : "Dodaj pierwszą notatkę – setup, analizę albo lekcję z rynku.";
      $("#emptyNew").classList.toggle("hidden", !!searching);
    }
  }

  function cardHtml(n) {
    const cat = catById(n.categoryId);
    const excerpt = plainText(n.body).slice(0, 260);
    return `<article class="card" data-note="${esc(n.id)}" style="--c:${cat?.color || "transparent"}" tabindex="0">
      ${n.pinned ? `<span class="pin-badge">${ICON.pin}</span>` : ""}
      ${n.images[0] ? `<img class="card-img" src="${imgUrl(n.images[0])}" alt="" loading="lazy">` : ""}
      <div class="card-inner">
        <div class="card-top">
          ${cat ? `<span class="card-cat"><span class="dot" style="background:${cat.color}"></span>${esc(cat.name)}</span>` : `<span class="card-cat">Bez kategorii</span>`}
          <span class="card-date">${fmtDate(n.updated)}</span>
        </div>
        ${n.title ? `<h3>${highlight(n.title)}</h3>` : ""}
        ${excerpt ? `<p>${highlight(excerpt)}</p>` : ""}
        ${n.tags.length || n.images.length > 1 ? `<div class="card-foot">
          ${n.tags.length ? `<div class="card-tags">${n.tags.slice(0, 4).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>` : ""}
          ${n.images.length > 1 ? `<span style="margin-left:auto">${ICON.img}${n.images.length}</span>` : ""}
        </div>` : ""}
      </div>
    </article>`;
  }

  // ---------- markdown-lite ----------
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  function renderMarkdown(md) {
    const lines = esc(md).split("\n");
    let html = "", list = null, para = [];
    const flushPara = () => { if (para.length) { html += `<p>${para.map(inline).join("<br>")}</p>`; para = []; } };
    const closeList = () => { if (list) { html += `</${list.tag}>`; list = null; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { flushPara(); closeList(); continue; }
      if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flushPara(); closeList(); const l = m[1].length + 1; html += `<h${l}>${inline(m[2])}</h${l}>`; continue; }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); closeList(); html += "<hr>"; continue; }
      if ((m = line.match(/^&gt;\s?(.*)/))) { flushPara(); closeList(); html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
      if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)/))) {
        flushPara();
        if (!list || list.tag !== "ul" || !list.checks) { closeList(); html += '<ul class="checks">'; list = { tag: "ul", checks: true }; }
        const done = m[1].toLowerCase() === "x";
        html += `<li class="${done ? "done" : ""}"><span class="cb ${done ? "done" : ""}"></span><span>${inline(m[2])}</span></li>`;
        continue;
      }
      if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
        flushPara();
        if (!list || list.tag !== "ul" || list.checks) { closeList(); html += "<ul>"; list = { tag: "ul" }; }
        html += `<li>${inline(m[1])}</li>`; continue;
      }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
        flushPara();
        if (!list || list.tag !== "ol") { closeList(); html += "<ol>"; list = { tag: "ol" }; }
        html += `<li>${inline(m[1])}</li>`; continue;
      }
      closeList();
      para.push(line);
    }
    flushPara(); closeList();
    return html;
  }

  // ---------- warstwy (modale) + przycisk wstecz ----------
  const layers = [];
  function openLayer(el) {
    el.classList.remove("hidden");
    layers.push(el);
    document.body.classList.add("lock");
    history.pushState({ tnLayer: layers.length }, "");
  }
  function hideTop() {
    const el = layers.pop();
    if (el) el.classList.add("hidden");
    if (!layers.length) document.body.classList.remove("lock");
    return el;
  }
  function closeLayer() { if (layers.length) history.back(); }
  window.addEventListener("popstate", () => {
    const top = layers[layers.length - 1];
    if (top === $("#editor") && editor.dirty() && !editor.skipGuard) {
      if (!confirm("Masz niezapisane zmiany. Zamknąć bez zapisywania?")) {
        history.pushState({ tnLayer: layers.length }, "");
        return;
      }
    }
    editor.skipGuard = false;
    const el = hideTop();
    if (el === $("#editor")) editor.cleanup();
  });

  // ---------- podgląd ----------
  let currentNoteId = null;
  function openViewer(id) {
    currentNoteId = id;
    renderViewer();
    openLayer($("#viewer"));
    $("#viewer .modal-body").scrollTop = 0;
  }
  function renderViewer() {
    const n = state.db.notes.find((x) => x.id === currentNoteId);
    if (!n) return;
    const cat = catById(n.categoryId);
    $("#vPin").classList.toggle("on", n.pinned);
    $("#vPin").title = n.pinned ? "Odepnij" : "Przypnij";
    $("#viewerBody").innerHTML = `
      <div class="v-meta">
        ${cat ? `<span class="card-cat"><span class="dot" style="background:${cat.color}"></span>${esc(cat.name)}</span>` : `<span class="card-cat">Bez kategorii</span>`}
        <time title="Utworzono">${fmtDate(n.created, true)}</time>
        ${n.updated !== n.created ? `<span>· edytowano ${fmtDate(n.updated)}</span>` : ""}
      </div>
      ${n.title ? `<h1>${esc(n.title)}</h1>` : ""}
      ${n.tags.length ? `<div class="card-tags">${n.tags.map((t) => `<button class="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}</div>` : ""}
      ${n.body.trim() ? `<div class="content">${renderMarkdown(n.body)}</div>` : ""}
      ${n.images.length ? `<div class="gallery ${n.images.length === 1 ? "single" : ""}">${n.images.map((im, i) => `<img src="${imgUrl(im)}" data-lb="${i}" alt="" loading="lazy">`).join("")}</div>` : ""}`;
  }
  $("#vEdit").addEventListener("click", () => editor.open(currentNoteId));
  $("#vPin").addEventListener("click", async () => {
    const n = state.db.notes.find((x) => x.id === currentNoteId);
    if (!n) return;
    n.pinned = !n.pinned;
    renderViewer(); render(); saveCache();
    try { setSync(1); const saved = await putJSON("notes/" + n.id, n); Object.assign(n, saved); setSync(-1); saveCache(); }
    catch (e) { setSync(-1, true); toast(e.message, true); }
  });
  $("#vDelete").addEventListener("click", async () => {
    if (!confirm("Usunąć tę notatkę? Tej operacji nie można cofnąć.")) return;
    const id = currentNoteId;
    try {
      setSync(1);
      await api("notes/" + id, { method: "DELETE" });
      state.db.notes = state.db.notes.filter((n) => n.id !== id);
      saveCache(); setSync(-1);
      closeLayer(); render(); toast("Notatka usunięta");
    } catch (e) { setSync(-1, true); toast(e.message, true); }
  });
  $("#viewerBody").addEventListener("click", (e) => {
    const img = e.target.closest("[data-lb]");
    if (img) {
      const n = state.db.notes.find((x) => x.id === currentNoteId);
      lightbox.open(n.images.map(imgUrl), +img.dataset.lb);
    }
    const tag = e.target.closest("[data-tag]");
    if (tag) { state.tag = tag.dataset.tag; closeLayer(); render(); }
  });

  // ---------- edytor ----------
  const editor = {
    noteId: null, tags: [], images: [], initial: "", skipGuard: false,
    snapshot() { return JSON.stringify([$("#eTitle").value, $("#eBody").value, $("#eCategory").value, this.tags, this.images.map((i) => i.id || i.url)]); },
    dirty() { return this.snapshot() !== this.initial; },
    open(id, presetCat) {
      const n = id ? state.db.notes.find((x) => x.id === id) : null;
      this.noteId = n ? n.id : null;
      $("#editorTitle").textContent = n ? "Edytuj notatkę" : "Nowa notatka";
      $("#eTitle").value = n?.title || "";
      $("#eBody").value = n?.body || "";
      $("#eCategory").innerHTML = `<option value="">Bez kategorii</option>` + sortedCats().map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
      $("#eCategory").value = n ? (n.categoryId && catById(n.categoryId) ? n.categoryId : "") : (presetCat || "");
      this.tags = n ? [...n.tags] : (state.tag ? [state.tag] : []);
      this.images = (n?.images || []).map((id) => ({ id, url: imgUrl(id) }));
      this.renderTags(); this.renderImages();
      $("#eTagInput").value = "";
      this.initial = this.snapshot();
      openLayer($("#editor"));
      $("#editor .modal-body").scrollTop = 0;
      if (!n && matchMedia("(min-width: 861px)").matches) setTimeout(() => $("#eTitle").focus(), 60);
    },
    cleanup() { this.images.forEach((i) => i.file && URL.revokeObjectURL(i.url)); this.images = []; },
    renderTags() {
      $("#eTags").innerHTML = this.tags.map((t, i) => `<span class="chip">#${esc(t)}<button type="button" data-rm-tag="${i}" aria-label="Usuń tag">${ICON.x}</button></span>`).join("");
    },
    addTag(raw) {
      raw.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean).forEach((t) => {
        if (!this.tags.includes(t) && this.tags.length < 30) this.tags.push(t.slice(0, 40));
      });
      this.renderTags();
    },
    renderImages() {
      $("#eImages").innerHTML = this.images.map((im, i) => `<div class="thumb ${im.file ? "pending" : ""}"><img src="${im.url}" alt=""><button type="button" data-rm-img="${i}" aria-label="Usuń zdjęcie">${ICON.x}</button></div>`).join("");
    },
    async addFiles(files) {
      const imgs = [...files].filter((f) => f.type.startsWith("image/"));
      for (const f of imgs) {
        try {
          const blob = await compressImage(f);
          this.images.push({ file: blob, url: URL.createObjectURL(blob) });
        } catch { toast("Nie udało się wczytać zdjęcia", true); }
      }
      this.renderImages();
    },
    async save() {
      if ($("#eTagInput").value.trim()) { this.addTag($("#eTagInput").value); $("#eTagInput").value = ""; }
      const title = $("#eTitle").value.trim();
      const body = $("#eBody").value;
      if (!title && !body.trim() && !this.images.length) { toast("Notatka jest pusta", true); return; }
      const btn = $("#saveBtn");
      btn.disabled = true; btn.textContent = "Zapisywanie…";
      setSync(1);
      try {
        const ids = [];
        for (const im of this.images) {
          if (im.id) { ids.push(im.id); continue; }
          const r = await api("images", { method: "POST", headers: { "content-type": im.file.type }, body: im.file });
          im.id = r.id; ids.push(r.id);
        }
        const existing = state.db.notes.find((x) => x.id === this.noteId);
        const id = this.noteId || uid("n");
        const saved = await putJSON("notes/" + id, {
          title, body, categoryId: $("#eCategory").value || null, tags: this.tags, images: ids, pinned: existing?.pinned || false,
        });
        if (existing) Object.assign(existing, saved); else state.db.notes.push(saved);
        saveCache(); setSync(-1);
        this.skipGuard = true;
        closeLayer();
        render();
        if (currentNoteId === id) renderViewer();
        toast(existing ? "Zapisano zmiany" : "Notatka dodana");
      } catch (e) {
        setSync(-1, true); toast(e.message, true);
      } finally { btn.disabled = false; btn.textContent = "Zapisz"; }
    },
  };

  $("#editorForm").addEventListener("submit", (e) => { e.preventDefault(); editor.save(); });
  $("#eTagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      if (e.target.value.trim()) { e.preventDefault(); editor.addTag(e.target.value); e.target.value = ""; }
      else if (e.key === "Enter") e.preventDefault();
    } else if (e.key === "Backspace" && !e.target.value && editor.tags.length) { editor.tags.pop(); editor.renderTags(); }
  });
  $("#eTagInput").addEventListener("change", (e) => { if (e.target.value.trim()) { editor.addTag(e.target.value); e.target.value = ""; } });
  $("#eTagsBox").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm-tag]");
    if (rm) { editor.tags.splice(+rm.dataset.rmTag, 1); editor.renderTags(); return; }
    $("#eTagInput").focus();
  });
  $("#eImages").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm-img]");
    if (rm) {
      const [im] = editor.images.splice(+rm.dataset.rmImg, 1);
      if (im.file) URL.revokeObjectURL(im.url);
      editor.renderImages(); return;
    }
    const img = e.target.closest(".thumb img");
    if (img) lightbox.open(editor.images.map((i) => i.url), $$(".thumb img").indexOf(img));
  });
  $("#eFile").addEventListener("change", (e) => { editor.addFiles(e.target.files); e.target.value = ""; });
  const dz = $("#dropZone");
  ["dragenter", "dragover"].forEach((ev) => $("#editor").addEventListener(ev, (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); dz.classList.add("drag"); } }));
  ["dragleave", "drop"].forEach((ev) => $("#editor").addEventListener(ev, (e) => { if (ev === "dragleave" && e.relatedTarget && $("#editor").contains(e.relatedTarget)) return; dz.classList.remove("drag"); }));
  $("#editor").addEventListener("drop", (e) => { e.preventDefault(); editor.addFiles(e.dataTransfer.files); });
  document.addEventListener("paste", (e) => {
    if ($("#editor").classList.contains("hidden")) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); editor.addFiles(files); toast("Wklejono zrzut ekranu"); }
  });

  // kompresja zdjęć (zrzuty z TradingView potrafią ważyć kilka MB)
  async function compressImage(file) {
    if (file.type === "image/gif") return file;
    const bmp = await createImageBitmap(file).catch(() => null);
    let w, h, src = bmp;
    if (!bmp) {
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    }
    w = src.width; h = src.height;
    const max = 2200;
    const scale = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/webp", 0.88));
    if (blob && blob.type === "image/webp" && blob.size < file.size) return blob;
    const jpg = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
    return jpg && jpg.size < file.size ? jpg : file;
  }

  // ---------- kategorie ----------
  let editingCat = null, catColor = COLORS[0];
  function openCatModal(id) {
    const c = id ? catById(id) : null;
    editingCat = c;
    $("#catModalTitle").textContent = c ? "Edytuj kategorię" : "Nowa kategoria";
    $("#catName").value = c?.name || "";
    catColor = c?.color || COLORS[state.db.categories.length % COLORS.length];
    renderSwatches();
    $("#catDelete").classList.toggle("hidden", !c);
    openLayer($("#catModal"));
    if (matchMedia("(min-width: 861px)").matches) setTimeout(() => $("#catName").focus(), 60);
  }
  function renderSwatches() {
    $("#catColors").innerHTML = COLORS.map((c) => `<button type="button" class="swatch ${c === catColor ? "active" : ""}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join("");
  }
  $("#catColors").addEventListener("click", (e) => { const s = e.target.closest("[data-color]"); if (s) { catColor = s.dataset.color; renderSwatches(); } });
  $("#catForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#catName").value.trim();
    if (!name) return;
    const id = editingCat?.id || uid("c");
    try {
      setSync(1);
      const saved = await putJSON("categories/" + id, { name, color: catColor, order: editingCat?.order ?? state.db.categories.length });
      const idx = state.db.categories.findIndex((c) => c.id === id);
      if (idx >= 0) state.db.categories[idx] = saved; else state.db.categories.push(saved);
      saveCache(); setSync(-1);
      closeLayer();
      if (!editingCat) state.filter = id;
      render();
    } catch (err) { setSync(-1, true); toast(err.message, true); }
  });
  $("#catDelete").addEventListener("click", async () => {
    const c = editingCat;
    const count = state.db.notes.filter((n) => n.categoryId === c.id).length;
    if (!confirm(`Usunąć kategorię „${c.name}”?` + (count ? `\n${count} notatek trafi do „Bez kategorii” (nie zostaną usunięte).` : ""))) return;
    try {
      setSync(1);
      await api("categories/" + c.id, { method: "DELETE" });
      state.db.categories = state.db.categories.filter((x) => x.id !== c.id);
      state.db.notes.forEach((n) => { if (n.categoryId === c.id) n.categoryId = null; });
      if (state.filter === c.id) state.filter = "all";
      saveCache(); setSync(-1);
      closeLayer(); render();
    } catch (err) { setSync(-1, true); toast(err.message, true); }
  });

  // ---------- lightbox ----------
  const lightbox = {
    urls: [], i: 0,
    open(urls, i) { this.urls = urls; this.i = i; this.show(); openLayer($("#lightbox")); },
    show() {
      $("#lbImg").src = this.urls[this.i];
      $("#lbCount").textContent = this.urls.length > 1 ? `${this.i + 1} / ${this.urls.length}` : "";
      $$(".lb-nav").forEach((b) => b.style.visibility = this.urls.length > 1 ? "visible" : "hidden");
    },
    step(d) { if (this.urls.length < 2) return; this.i = (this.i + d + this.urls.length) % this.urls.length; this.show(); },
  };
  $(".lb-prev").addEventListener("click", (e) => { e.stopPropagation(); lightbox.step(-1); });
  $(".lb-next").addEventListener("click", (e) => { e.stopPropagation(); lightbox.step(1); });
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id !== "lbImg") closeLayer(); });
  let touchX = null;
  $("#lightbox").addEventListener("touchstart", (e) => { touchX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  $("#lightbox").addEventListener("touchend", (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) lightbox.step(dx < 0 ? 1 : -1);
    touchX = null;
  });

  // ---------- zdarzenia globalne ----------
  function setFilter(f) {
    state.filter = f;
    closeSidebar();
    render();
    window.scrollTo({ top: 0 });
  }
  $("#sidebar").addEventListener("click", (e) => {
    const editCat = e.target.closest("[data-edit-cat]");
    if (editCat) { e.stopPropagation(); closeSidebar(); openCatModal(editCat.dataset.editCat); return; }
    const f = e.target.closest("[data-filter]");
    if (f) return setFilter(f.dataset.filter);
    const t = e.target.closest("[data-tag]");
    if (t) { state.tag = state.tag === t.dataset.tag ? null : t.dataset.tag; closeSidebar(); render(); }
  });
  $("#sidebar").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".cat-item")) setFilter(e.target.dataset.filter); });
  $("#addCategory").addEventListener("click", () => { closeSidebar(); openCatModal(null); });
  $("#notes").addEventListener("click", (e) => { const c = e.target.closest("[data-note]"); if (c) openViewer(c.dataset.note); });
  $("#notes").addEventListener("keydown", (e) => { if (e.key === "Enter") { const c = e.target.closest("[data-note]"); if (c) openViewer(c.dataset.note); } });
  $("#activeTag").addEventListener("click", (e) => { if (e.target.closest("[data-clear-tag]")) { state.tag = null; render(); } });
  const newNote = () => editor.open(null, catById(state.filter) ? state.filter : "");
  ["#newNoteTop", "#newNoteFab", "#emptyNew"].forEach((s) => $(s).addEventListener("click", newNote));
  $$("[data-close]").forEach((b) => b.addEventListener("click", closeLayer));
  $$(".modal").forEach((m) => m.addEventListener("mousedown", (e) => { if (e.target === m) closeLayer(); }));

  let searchTimer;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = e.target.value; renderNotes(); }, 120);
  });
  $("#sortSelect").addEventListener("change", (e) => { state.prefs.sort = e.target.value; savePrefs(); renderNotes(); });
  $("#layoutSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-layout]"); if (b) { state.prefs.layout = b.dataset.layout; savePrefs(); renderNotes(); } });

  function openSidebar() { $("#sidebar").classList.add("open"); $("#scrim").classList.add("show"); }
  function closeSidebar() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("show"); }
  $("#openSidebar").addEventListener("click", openSidebar);
  $("#closeSidebar").addEventListener("click", closeSidebar);
  $("#scrim").addEventListener("click", closeSidebar);

  document.addEventListener("keydown", (e) => {
    const top = layers[layers.length - 1];
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (!top) $("#search").focus(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && top === $("#editor")) { e.preventDefault(); editor.save(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && top === $("#editor")) { e.preventDefault(); editor.save(); return; }
    if (e.key === "Escape") {
      if (top) { e.preventDefault(); closeLayer(); }
      else if (document.activeElement === $("#search")) { $("#search").value = ""; state.q = ""; renderNotes(); $("#search").blur(); }
      return;
    }
    if (top === $("#lightbox")) { if (e.key === "ArrowLeft") lightbox.step(-1); if (e.key === "ArrowRight") lightbox.step(1); return; }
    if (!top && !typing && e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); newNote(); }
    if (top === $("#viewer") && !typing && e.key.toLowerCase() === "e") { e.preventDefault(); editor.open(currentNoteId); }
  });

  // odśwież dane po powrocie do karty (np. dodałeś notatkę na telefonie)
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || $("#app").classList.contains("hidden") || layers.length) return;
    try { state.db = await api("data"); saveCache(); setSync(0); render(); } catch {}
  });
  window.addEventListener("online", () => setSync(0));
  window.addEventListener("offline", () => setSync(0, true));

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});

  boot();
})();
