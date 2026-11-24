// 阅读状态验收：两级目录、跳转不连坐、1 秒停留、100% 覆盖、手动标记、收起持久化。
import fs from "node:fs";
import path from "node:path";

const endpoint = "http://127.0.0.1:9222/json";
const origin = "http://127.0.0.1:6187";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPage() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const list = await (await fetch(endpoint)).json();
      const page = list.find((target) => target.type === "page");
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
    await sleep(250);
  }
  throw new Error("No page target found on port 9222");
}

const page = await findPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let sequence = 0;
const pending = new Map();
const exceptions = [];

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text || "unknown");
  }
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(JSON.stringify(message.error)));
  else resolve(message.result);
};

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluate failed");
  }
  return result.result.value;
}

async function waitFor(expression, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return;
    } catch {
      // navigation may replace the context
    }
    await sleep(120);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function resetServerState() {
  await fetch(`${origin}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1, lastBook: null, books: {} }),
  });
}

async function openBook(id = "a2a") {
  await send("Page.navigate", { url: `${origin}/?book=${id}` });
  await waitFor('document.querySelectorAll("#sheet .chapter").length > 0', "book chapters");
  await sleep(500);
}

async function serverReads(id = "a2a") {
  const state = await evaluate(`fetch("/api/state", { cache: "no-store" }).then((response) => response.json())`);
  return state?.books?.[id] || null;
}

async function scrollTo(selector, delay = 1400) {
  await evaluate(`(() => {
    const reader = document.getElementById("reader");
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!reader || !element) return false;
    const top = element.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 64;
    reader.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    return true;
  })()`);
  await sleep(delay);
}

async function scrollReaderTop(top, delay = 1400) {
  await evaluate(`document.getElementById("reader").scrollTo({ top: ${Math.round(top)}, behavior: "auto" })`);
  await sleep(delay);
}

function dotState(id) {
  return evaluate(`(() => {
    const row = document.querySelector('.toc-item[data-row="${id}"]');
    const dot = row ? row.querySelector(".toc-dot") : null;
    const marker = document.querySelector('.toc-page-state[data-toc-state="${id}"]');
    return {
      exists: !!row,
      p: dot ? dot.style.getPropertyValue("--p") : "",
      reading: dot ? dot.classList.contains("is-reading") : false,
      read: dot ? dot.classList.contains("is-read") : false,
      markerRead: marker ? marker.classList.contains("is-read") : false,
      markerReading: marker ? marker.classList.contains("is-reading") : false,
    };
  })()`);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

// ---- 1. 初始结构与零状态 ----
await send("Page.navigate", { url: "about:blank" });
await sleep(400);
await resetServerState();
await openBook();

const structure = await evaluate(`(() => {
  const railChapters = document.querySelectorAll('#toc-list .toc-item[data-row^="ch-"]').length;
  const railQuestions = document.querySelectorAll('#toc-list .toc-item--child').length;
  const sheetSubLists = document.querySelectorAll("#sheet .toc-page-sub").length;
  const sheetQuestions = document.querySelectorAll("#sheet .toc-page-sub li").length;
  return {
    railChapters,
    railQuestions,
    sheetSubLists,
    sheetQuestions,
    progress: document.getElementById("toc-progress-text").textContent,
    bar: document.getElementById("bar-section").textContent,
    readDots: document.querySelectorAll("#toc-list .toc-dot.is-read").length,
    expanded: document.querySelectorAll("#toc-list .toc-item.is-collapsed").length,
  };
})()`);

// ---- 2. 目录跳转不连坐 ----
await evaluate(`document.querySelector('#toc-list [data-target="ch-06"]').click();`);
await sleep(2600);
const afterJump = await evaluate(`(() => ({
  progress: document.getElementById("toc-progress-text").textContent,
  read: [...document.querySelectorAll("#toc-list .toc-item.is-read[data-row]")].map((item) => item.dataset.row),
  active: [...document.querySelectorAll("#toc-list .toc-row.is-active")].map((row) => row.dataset.target),
  bar: document.getElementById("bar-section").textContent,
}))()`);

// ---- 3. 停留不足一秒不记 ----
await scrollTo("#q-Q01", 300);
await scrollReaderTop(0, 600);
const shortDwell = await dotState("q-Q01");

// ---- 4. 停留超过一秒记部分覆盖 ----
await scrollTo("#q-Q01", 1800);
const longDwell = await dotState("q-Q01");
const progressAfterPartial = await evaluate('document.getElementById("toc-progress-text").textContent');

// ---- 5. 字号变化后比例不丢 ----
await evaluate('document.querySelector("[data-size=\\"1\\"]").click();');
await sleep(400);
const afterResize = await dotState("q-Q01");
await evaluate('document.querySelector("[data-size=\\"-1\\"]").click();');
await sleep(300);

// ---- 6. 滚完一题应标已读（逐步滚动，每步停留 1.1 秒） ----
const q01 = await evaluate(`(() => {
  const reader = document.getElementById("reader");
  const element = document.getElementById("q-Q01");
  const top = element.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 64;
  return { top: Math.max(0, top), height: element.getBoundingClientRect().height, viewport: reader.clientHeight };
})()`);
const step = Math.max(320, Math.round(q01.viewport * 0.6));
for (let offset = 0; offset <= q01.height + step; offset += step) {
  await scrollReaderTop(q01.top + offset, 1150);
}
const afterFullRead = await dotState("q-Q01");
const progressAfterQ01 = await evaluate('document.getElementById("toc-progress-text").textContent');

// ---- 7. 手动标记二级条目 ----
await evaluate(`document.querySelector('.toc-item[data-row="q-Q20"] .toc-dot').click()`);
await sleep(300);
const manualQ02Read = await dotState("q-Q20");
const progressAfterQ02 = await evaluate('document.getElementById("toc-progress-text").textContent');
await evaluate(`document.querySelector('.toc-item[data-row="q-Q20"] .toc-dot').click()`);
await sleep(300);
const manualQ02Unread = await dotState("q-Q20");

// ---- 8. 一级条目连带二级 ----
await evaluate(`document.querySelector('.toc-item[data-row="ch-01"] .toc-dot').click()`);
await sleep(400);
const chapterPropagation = await evaluate(`(() => {
  const ids = ["ch-01", "q-Q01", "q-Q02", "q-Q03", "q-Q04", "q-Q05", "q-Q06"];
  return Object.fromEntries(ids.map((id) => {
    const dot = document.querySelector('.toc-item[data-row="' + id + '"] .toc-dot');
    return [id, dot ? dot.classList.contains("is-read") : null];
  }));
})()`);
const progressAfterChapter = await evaluate('document.getElementById("toc-progress-text").textContent');

// ---- 9. 收起跨刷新 ----
await evaluate(`document.querySelector('.toc-item[data-row="ch-02"] .toc-caret').click()`);
await sleep(400);
const collapsedBefore = await evaluate(`(() => { const item = document.querySelector('.toc-item[data-row="ch-02"]'); return { collapsed: item.classList.contains("is-collapsed"), children: getComputedStyle(item.querySelector(".toc-children")).display }; })()`);

await send("Page.reload", { ignoreCache: true });
await waitFor('document.querySelectorAll("#sheet .chapter").length > 0', "reload chapters");
await sleep(900);
const persisted = await evaluate(`(() => {
  const chapter = document.querySelector('.toc-item[data-row="ch-02"]');
  const dots = ["ch-01", "q-Q01", "q-Q02", "q-Q06"].map((id) => {
    const dot = document.querySelector('.toc-item[data-row="' + id + '"] .toc-dot');
    return [id, dot ? dot.classList.contains("is-read") : null];
  });
  return {
    collapsed: chapter.classList.contains("is-collapsed"),
    childrenDisplay: getComputedStyle(chapter.querySelector(".toc-children")).display,
    dots: Object.fromEntries(dots),
    progress: document.getElementById("toc-progress-text").textContent,
  };
})()`);

// ---- 10. 服务端状态 ----
const stored = await serverReads();

console.log(JSON.stringify({
  structure,
  afterJump,
  shortDwell,
  longDwell,
  progressAfterPartial,
  afterResize,
  q01,
  afterFullRead,
  progressAfterQ01,
  manualQ02Read,
  progressAfterQ02,
  manualQ02Unread,
  chapterPropagation,
  progressAfterChapter,
  collapsedBefore,
  persisted,
  storedRead: stored?.read || null,
  storedCoverageKeys: stored?.coverage ? Object.keys(stored.coverage) : null,
  storedCollapsed: stored?.collapsed || null,
  exceptions,
}, null, 2));

socket.close();
