/* 书房 · 客户端
   三栏连续阅读：书库、目录、整本书。进度与书签只存本机。 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const STORE_KEY = "shufang.library.v1";
const SETTINGS_KEY = "shufang.settings.v1";
const SIZE_MIN = 15;
const SIZE_MAX = 21;

const els = {
  boot: $("#boot"),
  bootError: $("#boot-error"),
  bootErrorText: $("#boot-error-text"),
  app: $("#app"),
  bookList: $("#book-list"),
  bookCount: $("#book-count"),
  tocBook: $("#toc-book"),
  tocSub: $("#toc-sub"),
  tocProgressText: $("#toc-progress-text"),
  tocProgressFill: $("#toc-progress-fill"),
  tocList: $("#toc-list"),
  reader: $("#reader"),
  sheet: $("#sheet"),
  barBook: $("#bar-book"),
  barSection: $("#bar-section"),
  barProgress: $("#bar-progress"),
  barScroll: $("#bar-scroll"),
  btnBooks: $("#btn-books"),
  btnToc: $("#btn-toc"),
  btnSettings: $("#btn-settings"),
  btnTheme: $("#btn-theme"),
  settings: $("#settings"),
  sizeVal: $("#size-val"),
  scrim: $("#scrim"),
};

const state = {
  books: [],
  currentId: null,
  data: null,
  sections: [],
  sectionById: new Map(),
  rowById: new Map(),
  stateById: new Map(),
  readBtnById: new Map(),
  bmBtnById: new Map(),
  activeIndex: -1,
  activeSectionId: null,
  read: new Set(),
  manualUnread: new Set(),
  bookmarks: new Set(),
  coverage: new Map(),
  visibleSince: new Map(),
  collapsed: new Set(),
  suppressUntil: 0,
  programmatic: false,
  alignToken: 0,
  lastSample: 0,
  saveTimer: 0,
  store: emptyStore(),
  size: 17,
  theme: "paper",
  railBooks: 252,
  railToc: 276,
  token: 0,
  frame: 0,
};

/* ---------- 基础工具 ---------- */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(String(value || ""));
}

function safeAccent(value) {
  return isColor(value) ? value : "#943951";
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 本地存储不可用时，阅读本身不中断。 */
  }
}

function emptyStore() {
  return { version: 1, lastBook: null, books: {} };
}

function loadStore() {
  const saved = readJSON(STORE_KEY, null);
  if (!saved || typeof saved !== "object") return emptyStore();
  return {
    version: 1,
    lastBook: typeof saved.lastBook === "string" ? saved.lastBook : null,
    books: saved.books && typeof saved.books === "object" ? saved.books : {},
  };
}

/* ---------- 阅读覆盖区间 ---------- */

const DWELL_MS = 1000;
const COVERAGE_FULL = 0.995;

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((pair) => Array.isArray(pair) && pair.length === 2)
    .map(([start, end]) => [clamp(Number(start) || 0, 0, 1), clamp(Number(end) || 0, 0, 1)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 0.004) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function intervalTotal(intervals) {
  let total = 0;
  for (const [start, end] of intervals || []) total += end - start;
  return total;
}

function hydrateCoverage(raw) {
  const map = new Map();
  if (!raw || typeof raw !== "object") return map;
  for (const [id, intervals] of Object.entries(raw)) {
    if (!Array.isArray(intervals)) continue;
    const merged = mergeIntervals(intervals);
    if (merged.length) map.set(id, merged);
  }
  return map;
}

function serializeCoverage() {
  const out = {};
  for (const [id, intervals] of state.coverage) {
    if (!intervals.length) continue;
    out[id] = intervals.map(([start, end]) => [Number(start.toFixed(3)), Number(end.toFixed(3))]);
  }
  return out;
}

let remoteTimer = 0;

async function pushState() {
  if (window.__shufangNoFlush) return;
  try {
    await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.store),
      keepalive: true,
    });
  } catch (error) {
    console.warn("state sync failed", error);
  }
}

function scheduleRemoteSave(immediate = false) {
  window.clearTimeout(remoteTimer);
  if (immediate) {
    pushState();
    return;
  }
  remoteTimer = window.setTimeout(pushState, 350);
}

function flushRemoteState() {
  if (window.__shufangNoFlush) return;
  const body = JSON.stringify(state.store);
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/state", new Blob([body], { type: "application/json" }));
    return;
  }
  fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

async function hydrateStore() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      if (data && data.version === 1 && data.books && typeof data.books === "object") {
        state.store = {
          version: 1,
          lastBook: typeof data.lastBook === "string" ? data.lastBook : null,
          books: data.books,
        };
        writeJSON(STORE_KEY, state.store);
        return;
      }
    }
  } catch (error) {
    console.warn("server state unavailable", error);
  }
  scheduleRemoteSave(true);
}

function saveStore() {
  writeJSON(STORE_KEY, state.store);
  scheduleRemoteSave();
}

function loadSettings() {
  const saved = readJSON(SETTINGS_KEY, {});
  const size = Number(saved.size);
  state.size = Number.isFinite(size) ? clamp(Math.round(size), SIZE_MIN, SIZE_MAX) : 17;
  state.theme = saved.theme === "night" ? "night" : "paper";
  const railBooks = Number(saved.railBooks);
  const railToc = Number(saved.railToc);
  if (Number.isFinite(railBooks) && railBooks > 0) state.railBooks = railBooks;
  if (Number.isFinite(railToc) && railToc > 0) state.railToc = railToc;
}

function saveSettings() {
  writeJSON(SETTINGS_KEY, {
    size: state.size,
    theme: state.theme,
    railBooks: Math.round(state.railBooks),
    railToc: Math.round(state.railToc),
  });
}

function railLimits(key) {
  const max = Math.max(180, window.innerWidth * 0.25);
  const min = key === "railBooks" ? 186 : 200;
  return { min: Math.min(min, max), max };
}

function applyRailWidths() {
  const books = railLimits("railBooks");
  const toc = railLimits("railToc");
  state.railBooks = clamp(state.railBooks, books.min, books.max);
  state.railToc = clamp(state.railToc, toc.min, toc.max);
  document.documentElement.style.setProperty("--rail-books-w", `${Math.round(state.railBooks)}px`);
  document.documentElement.style.setProperty("--rail-toc-w", `${Math.round(state.railToc)}px`);
}

function initResizers() {
  const specs = [
    { el: $("#resize-books"), key: "railBooks" },
    { el: $("#resize-toc"), key: "railToc" },
  ];

  for (const spec of specs) {
    if (!spec.el) continue;
    spec.el.addEventListener("pointerdown", (event) => {
      if (window.innerWidth <= 1360 || event.button !== 0) return;
      event.preventDefault();
      spec.el.setPointerCapture(event.pointerId);
      spec.el.classList.add("is-dragging");
      document.body.classList.add("is-resizing");

      const startX = event.clientX;
      const startWidth = state[spec.key];
      const limits = railLimits(spec.key);

      const move = (moveEvent) => {
        state[spec.key] = clamp(startWidth + (moveEvent.clientX - startX), limits.min, limits.max);
        applyRailWidths();
      };

      const stop = () => {
        spec.el.removeEventListener("pointermove", move);
        spec.el.removeEventListener("pointerup", stop);
        spec.el.removeEventListener("pointercancel", stop);
        spec.el.classList.remove("is-dragging");
        document.body.classList.remove("is-resizing");
        saveSettings();
      };

      spec.el.addEventListener("pointermove", move);
      spec.el.addEventListener("pointerup", stop);
      spec.el.addEventListener("pointercancel", stop);
    });
  }
}

function applySettings() {
  document.documentElement.style.setProperty("--reader-size", `${state.size}px`);
  document.body.dataset.theme = state.theme;
  if (els.sizeVal) els.sizeVal.textContent = String(state.size);
  applyRailWidths();

  for (const button of $$("[data-set-theme]")) {
    button.classList.toggle("is-on", button.dataset.setTheme === state.theme);
  }

  if (els.btnTheme) {
    const dark = state.theme === "night";
    els.btnTheme.textContent = dark ? "日" : "夜";
    els.btnTheme.setAttribute("aria-label", dark ? "切换到纸色" : "切换到夜间");
    els.btnTheme.title = dark ? "切换到纸色" : "切换到夜间";
    els.btnTheme.classList.toggle("is-on", dark);
  }
}

function applyAccent(meta, index) {
  const accent = safeAccent(meta?.accent || index?.accent);
  const light = isColor(meta?.light) ? meta.light : "#f4ebee";
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-light", light);
}

async function fetchJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

/* ---------- 启动 ---------- */

async function init() {
  loadSettings();
  applySettings();
  state.store = loadStore();
  await hydrateStore();

  try {
    const shelf = await fetchJSON("./data/books.json");
    state.books = Array.isArray(shelf.books) ? shelf.books : [];
    if (!state.books.length) throw new Error("书架是空的");

    els.bookCount.textContent = String(state.books.length);
    renderBookList();
    els.app.hidden = false;

    const params = new URLSearchParams(location.search);
    const requested = params.get("book");
    const last = state.books.some((book) => book.id === state.store.lastBook) ? state.store.lastBook : null;
    const id = state.books.some((book) => book.id === requested) ? requested : last || state.books[0].id;

    await loadBook(id, { initial: true });
    window.setInterval(() => sampleCoverage(), 450);
    finishBoot();
  } catch (error) {
    console.error(error);
    els.boot.hidden = true;
    els.bootError.hidden = false;
    els.bootErrorText.textContent = `没有读到书库数据：${error.message}`;
  }
}

function finishBoot() {
  els.app.hidden = false;
  els.boot.classList.add("is-done");
  window.setTimeout(() => {
    els.boot.hidden = true;
  }, 520);
}

/* ---------- 载入一本书 ---------- */

async function loadBook(id, { initial = false } = {}) {
  const index = state.books.find((book) => book.id === id) || state.books[0];
  if (!index) throw new Error("没有可打开的书");

  if (index.kind === "pdf") {
    loadPdf(index, { initial });
    return;
  }

  const token = ++state.token;
  const data = await fetchJSON(`./data/book-${index.id}.json`);
  if (token !== state.token) return;

  state.currentId = index.id;
  state.data = data;

  const saved = state.store.books[index.id] || {};
  state.read = new Set(Array.isArray(saved.read) ? saved.read : []);
  state.manualUnread = new Set(Array.isArray(saved.manualUnread) ? saved.manualUnread : []);
  state.bookmarks = new Set(Array.isArray(saved.bookmarks) ? saved.bookmarks : []);
  state.coverage = hydrateCoverage(saved.coverage);
  state.visibleSince.clear();
  state.collapsed = new Set(Array.isArray(saved.collapsed) ? saved.collapsed : []);
  state.programmatic = false;
  state.suppressUntil = performance.now() + 700;
  state.activeIndex = -1;
  state.activeSectionId = null;

  applyAccent(data.meta, index);
  els.reader.scrollTop = 0;
  els.barScroll.style.transform = "scaleX(0)";

  renderSheet();
  renderTocRail();
  updateBookListCurrent(index.id);

  els.tocBook.textContent = data.meta.title;
  els.tocSub.textContent = `${data.meta.series} · ${data.meta.stat || `${data.meta.count} 题 · ${data.meta.modules} 模块`}`;
  els.barBook.textContent = data.meta.title;
  document.title = `${data.meta.title} · 书房`;

  state.store.lastBook = index.id;
  applyReadUI();
  updateProgress();

  const hash = initial ? decodeURIComponent(location.hash.replace(/^#/, "")) : "";
  if (hash) {
    requestAnimationFrame(() => scrollToId(hash, { smooth: false, updateUrl: false }));
    window.setTimeout(() => {
      if (token === state.token) scrollToId(hash, { smooth: false, updateUrl: false });
    }, 480);
  } else {
    els.reader.scrollTop = 0;
  }

  setUrl(hash);
  saveStore();
  requestAnimationFrame(() => updateActive(true));
  window.setTimeout(() => {
    if (token === state.token) updateActive(true);
  }, 520);
}

function renderSheet() {
  const data = state.data;
  els.sheet.innerHTML = [
    data.coverHtml,
    ...data.front.map((section) => section.html),
    data.tocHtml,
    ...data.chapters.map((chapter) => chapter.html),
    data.backHtml,
  ].join("");

  collectSheetState();
}

function collectSheetState() {
  state.sections = $$("[data-section]", els.sheet).map((element) => ({
    el: element,
    id: element.dataset.section,
    label: element.dataset.label || "",
    chapterId: element.dataset.chapter || null,
  }));
  state.sectionById = new Map(state.sections.map((section) => [section.id, section]));
  state.stateById = new Map($$("[data-toc-state]", els.sheet).map((element) => [element.dataset.tocState, element]));
  state.readBtnById = new Map($$("[data-read]", els.sheet).map((button) => [button.dataset.read, button]));
  state.bmBtnById = new Map($$("[data-bookmark]", els.sheet).map((button) => [button.dataset.bookmark, button]));
}

function loadPdf(index, { initial = false } = {}) {
  const token = ++state.token;
  const saved = state.store.books[index.id] || {};
  state.currentId = index.id;
  state.data = {
    kind: "pdf",
    meta: index,
    chapters: [{ id: "pdf-view", num: "PDF", title: "全文", count: 1 }],
  };
  state.read = new Set(Array.isArray(saved.read) ? saved.read : []);
  state.manualUnread = new Set(Array.isArray(saved.manualUnread) ? saved.manualUnread : []);
  state.bookmarks = new Set(Array.isArray(saved.bookmarks) ? saved.bookmarks : []);
  state.coverage = hydrateCoverage(saved.coverage);
  state.visibleSince.clear();
  state.collapsed = new Set(Array.isArray(saved.collapsed) ? saved.collapsed : []);
  state.programmatic = false;
  state.suppressUntil = performance.now() + 700;
  state.activeIndex = -1;
  state.activeSectionId = null;

  applyAccent(index, index);
  els.reader.scrollTop = 0;
  els.barScroll.style.transform = "scaleX(0)";

  renderPdfSheet();
  renderTocRail();
  updateBookListCurrent(index.id);

  els.tocBook.textContent = index.title;
  els.tocSub.textContent = `PDF · ${index.pages ? `${index.pages} 页 · ` : ""}${index.category}`;
  els.barBook.textContent = index.title;
  document.title = `${index.title} · 书房`;

  state.store.lastBook = index.id;
  applyReadUI();
  updateProgress();

  const hash = initial ? decodeURIComponent(location.hash.replace(/^#/, "")) : "";
  if (hash) {
    requestAnimationFrame(() => scrollToId(hash, { smooth: false, updateUrl: false }));
    window.setTimeout(() => {
      if (token === state.token) scrollToId(hash, { smooth: false, updateUrl: false });
    }, 480);
  } else {
    els.reader.scrollTop = 0;
  }

  setUrl(hash);
  saveStore();
  requestAnimationFrame(() => updateActive(true));
  window.setTimeout(() => {
    if (token === state.token) updateActive(true);
  }, 520);
}

function renderPdfToc() {
  els.tocList.innerHTML = `<div class="toc-group"><p class="toc-group-label">PDF <span>FULL · 1</span></p><a class="toc-row" href="#pdf-view" data-target="pdf-view"><span class="toc-row-no">PDF</span><span class="toc-row-title">全文</span><span class="toc-row-dot" data-toc-state="pdf-view" aria-hidden="true"></span></a></div>`;
  state.rowById = new Map($$("[data-target]", els.tocList).map((row) => [row.dataset.target, row]));
}

function renderPdfSheet() {
  const meta = state.data.meta;
  const pages = meta.pages ? `${meta.pages} 页` : "PDF 文档";
  const rows = [
    ["作者", meta.author || "DeepSeek Harness"],
    ["出版", meta.publisher || "深度求索出版社"],
    ["年份", String(meta.year || 2026)],
    ["格式", "PDF"],
    ["页数", pages],
    ["分类", meta.category || "未分类"],
  ];

  els.sheet.innerHTML = `<div class="cover-page">
  <div class="page-label"><span>封面</span><span>COVER</span></div>
  <div class="cover-grid">
    <div class="cover-visual"><div class="cover-fallback"><small>${esc(meta.category)} · PDF</small><strong>${esc(
      meta.title,
    )}</strong><span>${esc(meta.subtitle)}</span></div></div>
    <div class="cover-copy">
      <p class="eyebrow"><span></span>${esc(meta.series || "深度求索技术书系")}</p>
      <h1>${esc(meta.title)}</h1>
      <p class="cover-sub">${esc(meta.subtitle)}</p>
      <p class="cover-tagline">${esc(meta.tagline || "")}</p>
      <dl class="meta-grid">${rows
        .map(([term, value]) => `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`)
        .join("")}</dl>
      <div class="cover-actions">
        <button type="button" class="btn-primary" data-scroll="pdf-view">打开 PDF</button>
        <a class="btn-ghost" href="./${esc(meta.pdf)}" target="_blank" rel="noopener">新窗口打开</a>
      </div>
      <p class="cover-note">PDF 原文件 · 浏览器内置阅读器</p>
    </div>
  </div>
</div>
<section class="chapter pdf-chapter" id="pdf-view" data-section="pdf-view" data-label="PDF 全文" data-chapter="pdf-view">
  <div class="chapter-head">
    <div class="chapter-top">
      <div class="chapter-ident"><span class="chapter-no">PDF</span><span class="chapter-meta">${esc(pages)}</span></div>
      <div class="chapter-tools"><button type="button" class="tool-btn" data-read="pdf-view" aria-pressed="false">标记已读</button></div>
    </div>
    <h2 class="chapter-title">${esc(meta.title)}</h2>
    <p class="chapter-lead">${esc(meta.subtitle)}</p>
  </div>
  <div class="pdf-wrap"><iframe class="pdf-frame" src="./${esc(meta.pdf)}#view=FitH" title="${esc(meta.title)} PDF"></iframe></div>
  <p class="pdf-note">浏览器内置 PDF 阅读器 · 可用“新窗口打开”全屏阅读</p>
</section>`;
  collectSheetState();
}

function setUrl(hash) {
  const url = new URL(location.href);
  url.searchParams.set("book", state.currentId);
  url.hash = hash || "";
  history.replaceState(null, "", url);
}

/* ---------- 左栏 ---------- */

const CATEGORY_ORDER = ["Agent", "Coding", "AI Discussions", "AI Coding Agents Reference", "管理"];

function bookCard(book) {
  const saved = state.store.books[book.id] || {};
  const read = Array.isArray(saved.read) ? saved.read.length : 0;
  const total = Number(book.modules) || 1;
  const percent = Math.min(100, Math.round((read / total) * 100));
  const accent = safeAccent(book.accent);
  const isPdf = book.kind === "pdf";
  const thumb = book.coverThumb
    ? `<img src="./${esc(book.coverThumb)}" alt="" loading="lazy" onerror="this.remove()">`
    : "";
  const meta = isPdf
    ? `PDF${book.pages ? ` · ${esc(book.pages)} 页` : ""}`
    : book.stat || `${esc(book.count)} 题 · ${esc(book.modules)} 模块`;

  return `<a class="book-card${isPdf ? " book-card--pdf" : ""}" href="?book=${encodeURIComponent(book.id)}" data-book="${esc(
    book.id,
  )}" style="--book-accent:${accent}">
  <span class="book-thumb"><span class="thumb-fallback">${esc(book.title)}</span>${thumb}</span>
  <span class="book-card-body">
    <span class="book-card-title">${esc(book.title)}</span>
    <span class="book-card-meta">${meta}</span>
    <span class="book-card-progress"><i style="width:${percent}%"></i></span>
  </span>
</a>`;
}

function renderBookList() {
  const groups = new Map(CATEGORY_ORDER.map((category) => [category, []]));
  for (const book of state.books) {
    const category = book.category || "其他";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(book);
  }
  els.bookList.innerHTML = [...groups.entries()]
    .filter(([, books]) => books.length)
    .map(
      ([category, books]) =>
        `<div class="book-group"><p class="book-group-label">${esc(category)}<span>${books.length}</span></p>${books
          .map(bookCard)
          .join("")}</div>`,
    )
    .join("");
}

function updateBookListCurrent(id) {
  for (const card of $$(".book-card", els.bookList)) {
    const current = card.dataset.book === id;
    card.classList.toggle("is-current", current);
    if (current) {
      card.setAttribute("aria-current", "true");
      card.scrollIntoView({ block: "nearest" });
    } else {
      card.removeAttribute("aria-current");
    }
  }
}

/* ---------- 中栏 ---------- */

function renderTocRail() {
  if (state.data?.kind === "pdf") {
    renderPdfToc();
    return;
  }

  const data = state.data;
  const plainRow = (id, title) =>
    `<a class="toc-row toc-row--plain" href="#${esc(id)}" data-target="${esc(id)}"><span class="toc-row-no">·</span><span class="toc-row-title">${esc(
      title,
    )}</span></a>`;

  const sectionRow = (section) =>
    `<div class="toc-item toc-item--child" data-row="${esc(section.id)}">
  <div class="toc-row-wrap">
    <a class="toc-row toc-row--child" href="#${esc(section.id)}" data-target="${esc(section.id)}">
      <span class="toc-row-qno">${esc(section.qno)}</span>
      <span class="toc-row-title">${esc(section.title)}</span>
    </a>
    <button type="button" class="toc-dot" data-toggle-read="${esc(section.id)}" aria-pressed="false" aria-label="标记已读：${esc(
      section.title,
    )}"></button>
  </div>
</div>`;

  const chapterRow = (chapter) => {
    const sections = chapter.sections || [];
    const sub = sections.length
      ? `<div class="toc-children">${sections.map(sectionRow).join("")}</div>`
      : "";
    return `<div class="toc-item${sections.length ? " has-children" : ""}" data-row="${esc(chapter.id)}">
  <div class="toc-row-wrap">
    ${
      sections.length
        ? `<button type="button" class="toc-caret" data-caret="${esc(
            chapter.id,
          )}" aria-expanded="true" aria-label="收起或展开本章"></button>`
        : ""
    }
    <a class="toc-row" href="#${esc(chapter.id)}" data-target="${esc(chapter.id)}"><span class="toc-row-no">${esc(
      chapter.num,
    )}</span><span class="toc-row-title">${esc(
      chapter.title,
    )}</span><span class="toc-row-bm" aria-hidden="true"></span></a>
    <button type="button" class="toc-dot" data-toggle-read="${esc(chapter.id)}" aria-pressed="false" aria-label="标记已读：${esc(
      chapter.title,
    )}"></button>
  </div>
  ${sub}
</div>`;
  };

  const frontRows = [
    plainRow("cover", "封面"),
    ...data.front.map((section) => plainRow(section.id, section.title)),
    plainRow("toc", "目录"),
  ];

  els.tocList.innerHTML = `<div class="toc-group"><p class="toc-group-label">卷首 <span>FRONT · ${frontRows.length}</span></p>${frontRows.join(
    "",
  )}</div>
<div class="toc-group"><p class="toc-group-label">正文 <span>BODY · ${data.chapters.length}</span></p>${data.chapters
    .map(chapterRow)
    .join("")}</div>
<div class="toc-group"><p class="toc-group-label">卷末 <span>BACK · 1</span></p>${plainRow("back", "封底")}</div>`;

  state.rowById = new Map($$("[data-target]", els.tocList).map((row) => [row.dataset.target, row]));

  for (const id of state.collapsed) {
    const item = state.rowById.get(id)?.closest(".toc-item");
    if (!item) continue;
    item.classList.add("is-collapsed");
    item.querySelector(".toc-caret")?.setAttribute("aria-expanded", "false");
  }
}

/* ---------- 阅读状态 ---------- */

function chapterIsRead(chapter) {
  if (state.read.has(chapter.id)) return true;
  const sections = chapter.sections || [];
  return sections.length > 0 && sections.every((section) => state.read.has(section.id));
}

function entryFraction(id) {
  if (state.read.has(id)) return 1;
  return clamp(intervalTotal(state.coverage.get(id)), 0, 1);
}

function entryDots(id) {
  const nodes = [];
  const row = state.rowById.get(id);
  if (row) {
    const item = row.closest(".toc-item");
    const dot = item ? item.querySelector(".toc-dot") : row.querySelector(".toc-dot");
    if (dot) nodes.push(dot);
  }
  const marker = state.stateById.get(id);
  if (marker) nodes.push(marker);
  return nodes;
}

function paintEntry(id, readOverride = null) {
  const isRead = readOverride === null ? state.read.has(id) : readOverride;
  const status = isRead ? "read" : entryFraction(id) > 0.005 ? "reading" : "unread";
  const fraction = isRead ? 1 : entryFraction(id);
  for (const node of entryDots(id)) {
    node.classList.toggle("is-read", status === "read");
    node.classList.toggle("is-reading", status === "reading");
    node.style.setProperty("--p", `${(fraction * 100).toFixed(1)}%`);
    if (node.tagName === "BUTTON") {
      node.setAttribute("aria-pressed", String(status === "read"));
      node.title = status === "read" ? "点击标记为未读" : "点击标记为已读";
    }
  }

  const row = state.rowById.get(id);
  if (row) {
    row.classList.toggle("is-read", status === "read");
    row.closest(".toc-item")?.classList.toggle("is-read", status === "read");
  }
}

function applyReadUI() {
  if (!state.data) return;

  for (const chapter of state.data.chapters) {
    paintEntry(chapter.id, chapterIsRead(chapter));
    for (const section of chapter.sections || []) paintEntry(section.id);

    const row = state.rowById.get(chapter.id);
    if (row) row.classList.toggle("is-bookmarked", state.bookmarks.has(chapter.id));

    const readButton = state.readBtnById.get(chapter.id);
    if (readButton) {
      const read = chapterIsRead(chapter);
      readButton.classList.toggle("is-on", read);
      readButton.setAttribute("aria-pressed", String(read));
      readButton.textContent = read ? "已读" : "标记已读";
    }

    const markButton = state.bmBtnById.get(chapter.id);
    if (markButton) {
      const bookmarked = state.bookmarks.has(chapter.id);
      markButton.classList.toggle("is-on", bookmarked);
      markButton.setAttribute("aria-pressed", String(bookmarked));
      markButton.textContent = bookmarked ? "已书签" : "书签";
    }

    const section = state.sectionById.get(chapter.id);
    if (section) section.el.classList.toggle("is-read", chapterIsRead(chapter));
  }
}

function updateProgress() {
  if (!state.data) return;

  const chapters = state.data.chapters;
  const readChapters = chapters.filter(chapterIsRead).length;
  const totalQuestions = chapters.reduce((count, chapter) => count + (chapter.sections || []).length, 0);
  const readQuestions = chapters.reduce(
    (count, chapter) => count + (chapter.sections || []).filter((section) => state.read.has(section.id)).length,
    0,
  );
  const ratio = totalQuestions
    ? readQuestions / totalQuestions
    : chapters.length
      ? readChapters / chapters.length
      : 0;
  const percent = Math.round(ratio * 100);

  els.tocProgressText.textContent = totalQuestions
    ? `已读 ${readQuestions} / ${totalQuestions} 题`
    : `已读 ${readChapters} / ${chapters.length}`;
  els.tocProgressFill.style.width = `${percent}%`;
  els.barProgress.textContent = `已读 ${percent}%`;

  const card = $(`.book-card[data-book="${state.currentId}"]`, els.bookList);
  const bar = card?.querySelector(".book-card-progress i");
  if (bar) bar.style.width = `${percent}%`;
}

function scheduleSave() {
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => saveProgress(), 700);
}

function saveProgress() {
  if (!state.currentId) return;
  state.store.books[state.currentId] = {
    read: [...state.read],
    manualUnread: [...state.manualUnread],
    bookmarks: [...state.bookmarks],
    coverage: serializeCoverage(),
    collapsed: [...state.collapsed],
    lastSection: state.activeSectionId || null,
    updatedAt: new Date().toISOString(),
  };
  state.store.lastBook = state.currentId;
  saveStore();
}

function setRead(id, value, manual = true) {
  if (!id) return;

  if (value) {
    if (manual) state.manualUnread.delete(id);
    state.read.add(id);
  } else {
    state.read.delete(id);
    if (manual) {
      state.manualUnread.add(id);
      state.coverage.delete(id);
    }
  }

  applyReadUI();
  updateProgress();
  saveProgress();
}

function toggleEntryRead(id) {
  if (!id || !state.data) return;
  if (state.data.kind === "pdf") {
    setRead(id, !state.read.has(id), true);
    return;
  }

  const chapter = state.data.chapters.find((item) => item.id === id);
  const targets = chapter ? [chapter.id, ...(chapter.sections || []).map((section) => section.id)] : [id];
  const nextValue = !targets.every((target) => state.read.has(target));

  for (const target of targets) {
    if (nextValue) {
      state.read.add(target);
      state.manualUnread.delete(target);
    } else {
      state.read.delete(target);
      state.manualUnread.add(target);
      state.coverage.delete(target);
      state.visibleSince.delete(target);
    }
  }

  applyReadUI();
  updateProgress();
  saveProgress();
}

function toggleChapterCollapse(id) {
  if (!id) return;
  const row = state.rowById.get(id);
  const item = row?.closest(".toc-item");
  if (!item) return;
  const collapsed = !item.classList.contains("is-collapsed");
  item.classList.toggle("is-collapsed", collapsed);
  const caret = item.querySelector(".toc-caret");
  if (caret) caret.setAttribute("aria-expanded", String(!collapsed));
  if (collapsed) state.collapsed.add(id);
  else state.collapsed.delete(id);
  saveProgress();
}

function noteCoverage(id, start, end) {
  if (end <= start) return;
  const merged = mergeIntervals([...(state.coverage.get(id) || []), [start, end]]);
  state.coverage.set(id, merged);
  paintEntry(id);

  if (
    intervalTotal(merged) >= COVERAGE_FULL &&
    !state.read.has(id) &&
    !state.manualUnread.has(id)
  ) {
    state.read.add(id);
    applyReadUI();
    updateProgress();
    scheduleSave();
    return;
  }
  scheduleSave();
}

function sampleCoverage() {
  if (!state.data || state.data.kind === "pdf") return;

  const now = performance.now();
  if (now - state.lastSample < 160) return;
  state.lastSample = now;

  if (now < state.suppressUntil) {
    state.visibleSince.clear();
    return;
  }
  state.programmatic = false;

  const readerRect = els.reader.getBoundingClientRect();
  const top = readerRect.top + 60;
  const bottom = readerRect.bottom - 2;

  const visit = (id) => {
    const element = document.getElementById(id);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) return;

    const visibleTop = Math.max(rect.top, top);
    const visibleBottom = Math.min(rect.bottom, bottom);
    if (visibleBottom - visibleTop < 6) {
      state.visibleSince.delete(id);
      return;
    }
    if (state.manualUnread.has(id)) {
      state.visibleSince.delete(id);
      return;
    }

    if (!state.visibleSince.has(id)) state.visibleSince.set(id, now);
    if (now - state.visibleSince.get(id) < DWELL_MS) return;

    noteCoverage(
      id,
      clamp((visibleTop - rect.top) / rect.height, 0, 1),
      clamp((visibleBottom - rect.top) / rect.height, 0, 1),
    );
  };

  for (const chapter of state.data.chapters) {
    visit(chapter.id);
    for (const section of chapter.sections || []) visit(section.id);
  }
}

function toggleBookmark(id) {
  if (!id) return;
  if (state.bookmarks.has(id)) state.bookmarks.delete(id);
  else state.bookmarks.add(id);
  applyReadUI();
  saveProgress();
}


/* ---------- 滚动与高亮 ---------- */

function onScroll() {
  if (state.programmatic) state.suppressUntil = performance.now() + 280;
  if (state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    const max = els.reader.scrollHeight - els.reader.clientHeight;
    const ratio = max > 0 ? clamp(els.reader.scrollTop / max, 0, 1) : 0;
    els.barScroll.style.transform = `scaleX(${ratio})`;
    updateActive();
    sampleCoverage();
  });
}

function updateActive(force = false) {
  if (!state.sections.length) return;

  const readerTop = els.reader.getBoundingClientRect().top;
  const threshold = readerTop + 140;
  let index = 0;

  for (let i = 0; i < state.sections.length; i += 1) {
    if (state.sections[i].el.getBoundingClientRect().top <= threshold) index = i;
    else break;
  }

  if (!force && index === state.activeIndex) return;

  const previousIndex = state.activeIndex;
  const previous = state.sections[previousIndex];
  const current = state.sections[index];
  state.activeIndex = index;
  state.activeSectionId = current.id;

  if (previous && previous.id !== current.id) {
    const oldRow = state.rowById.get(previous.id);
    oldRow?.classList.remove("is-active");
    oldRow?.removeAttribute("aria-current");
  }

  const row = state.rowById.get(current.id);
  if (row) {
    row.classList.add("is-active");
    row.setAttribute("aria-current", "true");
    row.scrollIntoView({ block: "nearest" });
  }

  if (els.barSection) els.barSection.textContent = current.label || "";
}

function scrollToId(id, { smooth = true, updateUrl = true } = {}) {
  if (!id) return;
  const element = document.getElementById(id);
  if (!element) return;

  state.programmatic = true;
  state.suppressUntil = performance.now() + (smooth ? 900 : 320);
  state.visibleSince.clear();
  const alignToken = ++state.alignToken;

  const behavior = smooth ? "smooth" : "auto";
  if (id === "cover") {
    els.reader.scrollTo({ top: 0, behavior });
  } else {
    const top =
      element.getBoundingClientRect().top - els.reader.getBoundingClientRect().top + els.reader.scrollTop - 60;
    els.reader.scrollTo({ top: Math.max(0, top), behavior });
  }

  if (smooth && id !== "cover") {
    let attempts = 0;
    let stable = 0;
    const align = () => {
      if (alignToken !== state.alignToken) return;
      const delta = element.getBoundingClientRect().top - els.reader.getBoundingClientRect().top - 60;
      if (Math.abs(delta) > 3) {
        state.programmatic = true;
        state.suppressUntil = performance.now() + 320;
        els.reader.scrollBy({ top: delta, behavior: "auto" });
        stable = 0;
      } else {
        stable += 1;
      }
      attempts += 1;
      if (attempts < 12 && stable < 2) window.setTimeout(align, 260);
    };
    window.setTimeout(align, 420);
  }

  if (updateUrl) setUrl(id === "cover" ? "" : id);
}

/* ---------- 抽屉与设置 ---------- */

function closeDrawers() {
  els.app.classList.remove("drawer-books", "drawer-toc");
  els.scrim.hidden = true;
  els.btnBooks.setAttribute("aria-expanded", "false");
  els.btnToc.setAttribute("aria-expanded", "false");
}

function toggleDrawer(name) {
  closeSettings();
  const open = els.app.classList.contains(`drawer-${name}`);
  els.app.classList.remove("drawer-books", "drawer-toc");
  if (!open) els.app.classList.add(`drawer-${name}`);
  els.scrim.hidden = open;
  els.btnBooks.setAttribute("aria-expanded", String(!open && name === "books"));
  els.btnToc.setAttribute("aria-expanded", String(!open && name === "toc"));
}

function openSettings() {
  closeDrawers();
  els.settings.hidden = false;
  els.btnSettings.setAttribute("aria-expanded", "true");
}

function closeSettings() {
  els.settings.hidden = true;
  els.btnSettings.setAttribute("aria-expanded", "false");
}

function setTheme(theme) {
  state.theme = theme === "night" ? "night" : "paper";
  applySettings();
  saveSettings();
}

/* ---------- 事件 ---------- */

els.bookList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-book]");
  if (!card) return;
  event.preventDefault();
  closeDrawers();

  const id = card.dataset.book;
  if (id === state.currentId) {
    scrollToId("cover");
    return;
  }

  loadBook(id).catch((error) => {
    console.error(error);
    els.barSection.textContent = "读取失败";
  });
});

els.tocList.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-toggle-read]");
  if (toggle) {
    event.preventDefault();
    event.stopPropagation();
    toggleEntryRead(toggle.dataset.toggleRead);
    return;
  }

  const caret = event.target.closest("[data-caret]");
  if (caret) {
    event.preventDefault();
    toggleChapterCollapse(caret.dataset.caret);
    return;
  }

  const row = event.target.closest("[data-target]");
  if (!row) return;
  event.preventDefault();
  closeDrawers();
  scrollToId(row.dataset.target);
});

async function copyCode(button) {
  const block = button.closest(".code-block");
  const code = block ? block.querySelector("pre code") : null;
  if (!code) return;
  const text = code.textContent || "";
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    copied = false;
  }
  if (!copied) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
  }
  button.textContent = copied ? "已复制" : "复制失败";
  button.classList.toggle("is-done", copied);
  clearTimeout(button.copyTimer);
  button.copyTimer = setTimeout(() => {
    button.textContent = "复制";
    button.classList.remove("is-done");
  }, 1400);
}

els.sheet.addEventListener("click", (event) => {
  const scrollTarget = event.target.closest("[data-scroll]");
  if (scrollTarget) {
    event.preventDefault();
    scrollToId(scrollTarget.dataset.scroll);
    return;
  }

  const copyButton = event.target.closest("[data-copy]");
  if (copyButton) {
    copyCode(copyButton);
    return;
  }

  const readButton = event.target.closest("[data-read]");
  if (readButton) {
    toggleEntryRead(readButton.dataset.read);
    return;
  }

  const bookmarkButton = event.target.closest("[data-bookmark]");
  if (bookmarkButton) {
    toggleBookmark(bookmarkButton.dataset.bookmark);
  }
});

els.btnBooks.addEventListener("click", () => toggleDrawer("books"));
els.btnToc.addEventListener("click", () => toggleDrawer("toc"));
els.scrim.addEventListener("click", closeDrawers);

els.btnSettings.addEventListener("click", (event) => {
  event.stopPropagation();
  if (els.settings.hidden) openSettings();
  else closeSettings();
});

els.settings.addEventListener("click", (event) => {
  event.stopPropagation();
});

for (const button of $$("[data-close-settings]")) {
  button.addEventListener("click", closeSettings);
}

for (const button of $$("[data-size]")) {
  button.addEventListener("click", () => {
    const next = clamp(state.size + Number(button.dataset.size), SIZE_MIN, SIZE_MAX);
    if (next === state.size) return;
    state.size = next;
    applySettings();
    saveSettings();
  });
}

for (const button of $$("[data-set-theme]")) {
  button.addEventListener("click", () => setTheme(button.dataset.setTheme));
}

els.btnTheme.addEventListener("click", () => {
  setTheme(state.theme === "night" ? "paper" : "night");
});

document.addEventListener("click", (event) => {
  if (els.settings.hidden) return;
  if (els.settings.contains(event.target) || els.btnSettings.contains(event.target)) return;
  closeSettings();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!els.settings.hidden) {
      closeSettings();
      return;
    }
    closeDrawers();
    return;
  }

  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (!els.settings.hidden) return;
  if (typeof event.target.closest === "function" && event.target.closest("input, textarea, select, [contenteditable='true']")) {
    return;
  }
  if (!state.sections.length) return;

  const current = state.activeIndex < 0 ? 0 : state.activeIndex;
  const next =
    event.key === "ArrowRight"
      ? Math.min(state.sections.length - 1, current + 1)
      : Math.max(0, current - 1);
  if (next === current) return;

  event.preventDefault();
  scrollToId(state.sections[next].id);
});

els.reader.addEventListener("scroll", onScroll, { passive: true });

for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
  els.reader.addEventListener(
    type,
    () => {
      state.alignToken += 1;
      state.visibleSince.clear();
    },
    { passive: true },
  );
}

window.addEventListener("hashchange", () => {
  const id = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (id) scrollToId(id, { smooth: true, updateUrl: false });
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 1360) closeDrawers();
  applyRailWidths();
  updateActive(true);
});

window.addEventListener("beforeunload", () => {
  saveProgress();
  flushRemoteState();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    saveProgress();
    flushRemoteState();
  }
});

if ("scrollRestoration" in history) history.scrollRestoration = "manual";

/* ---------- 封面放大 ---------- */

(() => {
  const lb = document.getElementById("cover-lightbox");
  if (!lb) return;

  const img = document.getElementById("lightbox-img");
  const fallback = document.getElementById("lightbox-fallback");
  const stage = document.getElementById("lightbox-stage");
  const title = document.getElementById("lightbox-title");
  const zoomLabel = document.getElementById("lightbox-zoom");
  const zoomIn = document.getElementById("lightbox-zoom-in");
  const zoomOut = document.getElementById("lightbox-zoom-out");
  const closeBtn = document.getElementById("lightbox-close");
  const sheet = document.getElementById("sheet");

  let zoom = 1;
  let drag = null;

  function setZoom(value) {
    zoom = Math.min(3, Math.max(0.5, value));
    img.style.width = `${zoom * 100}%`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function fallbackCover(visual) {
    const card = document.createElement("div");
    card.className = "lightbox-fallback-cover";
    const series = document.createElement("small");
    series.textContent = visual.dataset.coverSeries || "";
    const name = document.createElement("strong");
    name.textContent = visual.dataset.coverTitle || "封面";
    const sub = document.createElement("span");
    sub.textContent = visual.dataset.coverSub || "";
    const author = document.createElement("em");
    author.textContent = visual.dataset.coverAuthor || "";
    card.append(series, name, sub, author);
    return card;
  }

  function open(visual) {
    const large = visual.dataset.coverLarge || "";
    const bookTitle = visual.dataset.coverTitle || "封面";
    title.textContent = bookTitle;

    if (large) {
      img.src = large;
      img.alt = `${bookTitle} 封面`;
      img.hidden = false;
      fallback.hidden = true;
    } else {
      img.hidden = true;
      img.removeAttribute("src");
      fallback.hidden = false;
      fallback.replaceChildren(fallbackCover(visual));
    }

    setZoom(1);
    stage.scrollTo(0, 0);
    lb.hidden = false;
    document.body.classList.add("lightbox-open");
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    lb.hidden = true;
    document.body.classList.remove("lightbox-open");
    img.removeAttribute("src");
    drag = null;
  }

  if (sheet) {
    sheet.addEventListener("click", (event) => {
      const visual = event.target.closest(".cover-visual");
      if (!visual) return;
      event.preventDefault();
      open(visual);
    });

    sheet.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!event.target.classList.contains("cover-visual")) return;
      event.preventDefault();
      open(event.target);
    });
  }

  zoomIn.addEventListener("click", () => setZoom(zoom + 0.25));
  zoomOut.addEventListener("click", () => setZoom(zoom - 0.25));
  closeBtn.addEventListener("click", close);
  lb.querySelector("[data-lightbox-close]").addEventListener("click", close);

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !lb.hidden) {
        event.stopPropagation();
        close();
      }
    },
    true
  );

  stage.addEventListener(
    "wheel",
    (event) => {
      if (lb.hidden) return;
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? 0.2 : -0.2));
    },
    { passive: false }
  );

  stage.addEventListener("pointerdown", (event) => {
    if (img.hidden) return;
    drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    stage.scrollLeft = drag.left - (event.clientX - drag.x);
    stage.scrollTop = drag.top - (event.clientY - drag.y);
  });

  const stopDrag = () => {
    drag = null;
  };
  stage.addEventListener("pointerup", stopDrag);
  stage.addEventListener("pointercancel", stopDrag);
})();

initResizers();
init();
