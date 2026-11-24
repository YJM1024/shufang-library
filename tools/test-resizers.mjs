// 分栏宽度验收：拖动、上下限、持久化、窄屏隐藏。
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

async function drag(fromX, fromY, toX, toY) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: fromX, y: fromY, button: "left", buttons: 1, clickCount: 1 });
  const steps = 6;
  for (let index = 1; index <= steps; index += 1) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(fromX + ((toX - fromX) * index) / steps),
      y: Math.round(fromY + ((toY - fromY) * index) / steps),
      button: "left",
      buttons: 1,
    });
    await sleep(30);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: toX, y: toY, button: "left", buttons: 0, clickCount: 1 });
  await sleep(250);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${origin}/?book=a2a` });
await waitFor('!!document.querySelector("#sheet .chapter")', "book loaded");
await sleep(600);

const initial = await evaluate(`(() => {
  const root = getComputedStyle(document.documentElement);
  const reader = document.getElementById("reader").getBoundingClientRect();
  return {
    books: root.getPropertyValue("--rail-books-w").trim(),
    toc: root.getPropertyValue("--rail-toc-w").trim(),
    readerX: Math.round(reader.x),
    readerWidth: Math.round(reader.width),
    booksHandle: (() => { const r = document.getElementById("resize-books").getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
    tocHandle: (() => { const r = document.getElementById("resize-toc").getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
    settings: localStorage.getItem("shufang.settings.v1"),
  };
})()`);

// 1. 拖动书库栏 +120px
await drag(initial.booksHandle.x + 4, 420, initial.booksHandle.x + 4 + 120, 420);
const afterDrag = await evaluate(`(() => {
  const root = getComputedStyle(document.documentElement);
  const reader = document.getElementById("reader").getBoundingClientRect();
  return {
    books: root.getPropertyValue("--rail-books-w").trim(),
    toc: root.getPropertyValue("--rail-toc-w").trim(),
    readerX: Math.round(reader.x),
    settings: JSON.parse(localStorage.getItem("shufang.settings.v1") || "{}"),
  };
})()`);

// 2. 拖到超过 25% 上限
await drag(initial.booksHandle.x + 120 + 4, 420, 1500, 420);
const afterMax = await evaluate(`(() => {
  const root = getComputedStyle(document.documentElement);
  return { books: root.getPropertyValue("--rail-books-w").trim(), innerWidth };
})()`);

// 3. 目录栏拖到上限
const tocHandleNow = await evaluate(`(() => { const r = document.getElementById("resize-toc").getBoundingClientRect(); return { x: Math.round(r.x) }; })()`);
await drag(tocHandleNow.x + 4, 420, 1580, 420);
const afterTocMax = await evaluate(`(() => {
  const root = getComputedStyle(document.documentElement);
  return { books: root.getPropertyValue("--rail-books-w").trim(), toc: root.getPropertyValue("--rail-toc-w").trim(), readerX: Math.round(document.getElementById("reader").getBoundingClientRect().x) };
})()`);

const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
fs.writeFileSync(path.join(process.cwd(), ".shots", "resized-columns.png"), Buffer.from(shot.data, "base64"));

// 4. 刷新后保持
await send("Page.reload", { ignoreCache: true });
await waitFor('!!document.querySelector("#sheet .chapter")', "reload book");
await sleep(800);
const afterReload = await evaluate(`(() => {
  const root = getComputedStyle(document.documentElement);
  return { books: root.getPropertyValue("--rail-books-w").trim(), toc: root.getPropertyValue("--rail-toc-w").trim() };
})()`);

// 5. 窄屏隐藏把手
await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);
const narrow = await evaluate(`(() => ({
  books: getComputedStyle(document.getElementById("resize-books")).display,
  toc: getComputedStyle(document.getElementById("resize-toc")).display,
  innerWidth,
}))()`);

await send("Emulation.clearDeviceMetricsOverride");

console.log(JSON.stringify({ initial, afterDrag, afterMax, afterTocMax, afterReload, narrow, exceptions }, null, 2));
socket.close();
