import fs from "node:fs";
import path from "node:path";

const endpoint = "http://127.0.0.1:9222/json";
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
const consoleMessages = [];
const exceptions = [];

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.consoleAPICalled") {
    consoleMessages.push({
      type: message.params.type,
      text: message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "),
    });
  }
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails.text || "unknown exception");
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

async function waitFor(expression, label, timeout = 9000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return;
    } catch {
      // The execution context may be replaced by a reload.
    }
    await sleep(120);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function click(selector) {
  const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error(`missing element: ${selector}`);
  await sleep(220);
}

async function scrollToSection(id) {
  const ok = await evaluate(`(() => {
    const reader = document.querySelector("#reader");
    const el = document.getElementById(${JSON.stringify(id)});
    if (!reader || !el) return false;
    const top = el.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 60;
    reader.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    return true;
  })()`);
  if (!ok) throw new Error(`missing section: ${id}`);
  await sleep(700);
}

function libraryState() {
  return evaluate(`(() => {
    const raw = localStorage.getItem("shufang.library.v1");
    return raw ? JSON.parse(raw) : null;
  })()`);
}

const report = {};

await send("Runtime.enable");
await send("Page.enable");
await evaluate(`(() => { window.__shufangNoFlush = true; Storage.prototype.setItem = function () {}; localStorage.clear(); return true; })()`);
await evaluate(`fetch("/api/state", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ version: 1, lastBook: null, books: {} }),
}).then((response) => response.ok)`);
await send("Page.navigate", { url: "http://127.0.0.1:6187/?book=a2a" });
await waitFor('(document.querySelector("#toc-book")?.textContent || "").includes("A2A")', "initial a2a book");
await waitFor('!!document.getElementById("ch-02") && document.querySelectorAll("#sheet .question").length === 50', "a2a sheet");

report.initial = await evaluate(`(() => ({
  book: document.querySelector("#toc-book")?.textContent.trim(),
  sub: document.querySelector("#toc-sub")?.textContent.trim(),
  chapters: document.querySelectorAll("#toc-list .toc-row[data-target^='ch-']").length,
  questions: document.querySelectorAll("#sheet .question").length,
  progress: document.querySelector("#toc-progress-text")?.textContent.trim(),
  bar: document.querySelector("#bar-section")?.textContent.trim(),
  size: getComputedStyle(document.documentElement).getPropertyValue("--reader-size").trim(),
  theme: document.body.dataset.theme,
}))()`);

await scrollToSection("ch-01");
report.atCh01 = await evaluate(`(() => ({
  ch01Active: document.querySelector('#toc-list [data-target="ch-01"]')?.classList.contains("is-active"),
  ch01Read: document.querySelector('#toc-list [data-target="ch-01"]')?.classList.contains("is-read"),
  progress: document.querySelector("#toc-progress-text")?.textContent.trim(),
  bar: document.querySelector("#bar-section")?.textContent.trim(),
}))()`);

await scrollToSection("ch-02");
report.afterScrollToCh02 = await evaluate(`(() => ({
  ch02Active: document.querySelector('#toc-list [data-target="ch-02"]')?.classList.contains("is-active"),
  ch01Read: document.querySelector('#toc-list [data-target="ch-01"]')?.classList.contains("is-read"),
  ch02Read: document.querySelector('#toc-list [data-target="ch-02"]')?.classList.contains("is-read"),
  progress: document.querySelector("#toc-progress-text")?.textContent.trim(),
  bar: document.querySelector("#bar-section")?.textContent.trim(),
  barProgress: document.querySelector("#bar-progress")?.textContent.trim(),
}))()`);

await click("#ch-02 [data-read]");
report.afterManualRead = await evaluate(`(() => ({
  button: document.querySelector("#ch-02 [data-read]")?.textContent.trim(),
  ch02Read: document.querySelector('#toc-list [data-target="ch-02"]')?.classList.contains("is-read"),
  progress: document.querySelector("#toc-progress-text")?.textContent.trim(),
}))()`);

await click("#ch-02 [data-read]");
report.afterManualUnread = await evaluate(`(() => ({
  button: document.querySelector("#ch-02 [data-read]")?.textContent.trim(),
  ch02Read: document.querySelector('#toc-list [data-target="ch-02"]')?.classList.contains("is-read"),
  progress: document.querySelector("#toc-progress-text")?.textContent.trim(),
}))()`);

await click("#ch-02 [data-bookmark]");
report.afterBookmark = await evaluate(`(() => ({
  button: document.querySelector("#ch-02 [data-bookmark]")?.textContent.trim(),
  rowBookmarked: document.querySelector('#toc-list [data-target="ch-02"]')?.classList.contains("is-bookmarked"),
}))()`);

await scrollToSection("ch-03");
report.afterScrollPastManualUnread = await evaluate(`(() => ({
  ch02Read: document.querySelector('#toc-list [data-target="ch-02"]')?.classList.contains("is-read"),
  ch03Active: document.querySelector('#toc-list [data-target="ch-03"]')?.classList.contains("is-active"),
  progress: document.querySelector("#toc-progress-text")?.textContent.trim(),
}))()`);

report.libraryAfterRead = await libraryState();

await click("#btn-settings");
report.settingsOpen = await evaluate(`(() => ({
  hidden: document.querySelector("#settings")?.hidden,
  size: document.querySelector("#size-val")?.textContent.trim(),
}))()`);
await click('[data-size="1"]');
await click('[data-set-theme="night"]');
report.settingsNight = await evaluate(`(() => ({
  size: document.querySelector("#size-val")?.textContent.trim(),
  cssSize: getComputedStyle(document.documentElement).getPropertyValue("--reader-size").trim(),
  theme: document.body.dataset.theme,
  readerBg: getComputedStyle(document.querySelector("#reader")).backgroundColor,
}))()`);
await click('[data-set-theme="paper"]');
await click('[data-size="-1"]');
await click("#btn-settings");
report.settingsReset = await evaluate(`(() => ({
  hidden: document.querySelector("#settings")?.hidden,
  size: document.querySelector("#size-val")?.textContent.trim(),
  theme: document.body.dataset.theme,
}))()`);

await click('.book-card[data-book="context-eng"]');
await waitFor('(document.querySelector("#toc-book")?.textContent || "").includes("上下文")', "context-eng book");
await waitFor('!!document.getElementById("ch-04") && document.querySelectorAll("#ch-04 .question").length === 6', "context-eng ch-04 sheet");
await sleep(350);
report.contextEng = await evaluate(`(() => ({
  book: document.querySelector("#toc-book")?.textContent.trim(),
  chapters: document.querySelectorAll("#ch-04 .question").length,
  chapterTitle: document.querySelector("#ch-04 .chapter-title")?.textContent.trim(),
  qRange: document.querySelector("#ch-04 .chapter-meta")?.textContent.trim(),
  accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  url: location.search + location.hash,
  progress: document.querySelector("#toc-progress-text")?.textContent.trim(),
}))()`);

await click('.book-card[data-book="a2a"]');
await waitFor('(document.querySelector("#toc-book")?.textContent || "").includes("A2A")', "a2a book again");
await waitFor('!!document.getElementById("ch-02") && document.querySelectorAll("#sheet .question").length === 50', "a2a sheet again");
await sleep(350);
report.backToA2A = await evaluate(`(() => ({
  book: document.querySelector("#toc-book")?.textContent.trim(),
  ch01Read: document.querySelector('#toc-list [data-target="ch-01"]')?.classList.contains("is-read"),
  ch02Read: document.querySelector('#toc-list [data-target="ch-02"]')?.classList.contains("is-read"),
  ch02Bookmarked: document.querySelector('#toc-list [data-target="ch-02"]')?.classList.contains("is-bookmarked"),
  progress: document.querySelector("#toc-progress-text")?.textContent.trim(),
  size: getComputedStyle(document.documentElement).getPropertyValue("--reader-size").trim(),
  theme: document.body.dataset.theme,
}))()`);

await send("Emulation.setDeviceMetricsOverride", {
  width: 430,
  height: 900,
  deviceScaleFactor: 1,
  mobile: true,
});
await sleep(700);
report.mobile430 = await evaluate(`(() => {
  const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  return {
    innerWidth,
    bar: rect(".reader-bar"),
    right: rect(".bar-right"),
    settings: rect("#btn-settings"),
    theme: rect("#btn-theme"),
  };
})()`);
const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
fs.writeFileSync(path.join(process.cwd(), ".shots", "mobile-430.png"), Buffer.from(shot.data, "base64"));
await send("Emulation.clearDeviceMetricsOverride");

await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await sleep(250);
await send("Page.reload", { ignoreCache: true });
await waitFor(`!!document.getElementById("ch-02") && document.querySelectorAll("#sheet .question").length === 50`);
await sleep(500);
await scrollToSection("ch-02");
await sleep(500);
const chapterShot = await send("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  clip: { x: 0, y: 12, width: 1600, height: 988, scale: 1 },
});
fs.writeFileSync(path.join(process.cwd(), ".shots", "chapter-state-1600.png"), Buffer.from(chapterShot.data, "base64"));

report.console = consoleMessages;
report.exceptions = exceptions;

console.log(JSON.stringify(report, null, 2));
socket.close();
