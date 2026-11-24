// 封面放大浮窗验收：打开、缩放、拖动、Esc 关闭、文字封面兜底。
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
const consoleMessages = [];

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text || "unknown");
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    consoleMessages.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
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

async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

async function pressEscape() {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(250);
}

// 把封面滚到可见位置，返回一个确认落在 .cover-visual 内的点击点。
async function coverClickPoint() {
  return evaluate(`(() => {
    const visual = document.querySelector("#sheet .cover-visual");
    if (!visual) return { error: "no .cover-visual" };
    const reader = document.getElementById("reader");
    const offset = visual.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 90;
    reader.scrollTo({ top: Math.max(0, offset), behavior: "auto" });
    const rect = visual.getBoundingClientRect();
    const cx = Math.round(rect.x + rect.width / 2);
    const cy = Math.round(rect.y + Math.min(rect.height / 2, 180));
    const hit = document.elementFromPoint(cx, cy);
    return {
      cx,
      cy,
      inside: hit ? !!hit.closest(".cover-visual") : false,
      hit: hit ? hit.tagName + "." + hit.className : "none",
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      hasImg: !!visual.querySelector("img"),
      large: visual.dataset.coverLarge || "",
      title: visual.dataset.coverTitle || "",
      label: visual.getAttribute("aria-label"),
      tabindex: visual.getAttribute("tabindex"),
    };
  })()`);
}

async function openCover(point) {
  await clickAt(point.cx, point.cy);
  await sleep(600);
  return !(await evaluate('document.getElementById("cover-lightbox").hidden'));
}

await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

// 1. 有真实封面的书（a2a）：打开
await send("Page.navigate", { url: `${origin}/?book=a2a` });
await waitFor('!!document.querySelector("#sheet .cover-visual img")', "a2a cover image");
await sleep(400);

const coverPoint = await coverClickPoint();
const coverOpened = await openCover(coverPoint);

const opened = await evaluate(`(() => {
  const lb = document.getElementById("cover-lightbox");
  const img = document.getElementById("lightbox-img");
  const stage = document.getElementById("lightbox-stage");
  const panel = lb.querySelector(".lightbox-panel");
  const rect = panel.getBoundingClientRect();
  return {
    hidden: lb.hidden,
    bodyClass: document.body.classList.contains("lightbox-open"),
    title: document.getElementById("lightbox-title").textContent,
    zoomLabel: document.getElementById("lightbox-zoom").textContent,
    imgHidden: img.hidden,
    imgSrc: img.getAttribute("src"),
    imgLoaded: img.complete && img.naturalWidth > 0,
    imgNatural: { w: img.naturalWidth, h: img.naturalHeight },
    imgWidth: img.style.width,
    fallbackHidden: document.getElementById("lightbox-fallback").hidden,
    panel: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    activeId: document.activeElement ? document.activeElement.id : "",
    stageScroll: { w: stage.scrollWidth, h: stage.scrollHeight, cw: stage.clientWidth, ch: stage.clientHeight },
  };
})()`);

// 2. 按钮放大两次
await evaluate('document.getElementById("lightbox-zoom-in").click();');
await evaluate('document.getElementById("lightbox-zoom-in").click();');
await sleep(200);
const afterButtons = await evaluate(`({ zoom: document.getElementById("lightbox-zoom").textContent, width: document.getElementById("lightbox-img").style.width })`);

// 3. 滚轮放大
await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 700, y: 500, deltaX: 0, deltaY: -120 });
await sleep(250);
const afterWheel = await evaluate(`({ zoom: document.getElementById("lightbox-zoom").textContent, width: document.getElementById("lightbox-img").style.width })`);

// 4. 缩小到下限
await evaluate('for (let i = 0; i < 8; i += 1) document.getElementById("lightbox-zoom-out").click();');
await sleep(150);
const atMin = await evaluate(`({ zoom: document.getElementById("lightbox-zoom").textContent, width: document.getElementById("lightbox-img").style.width })`);

// 5. 拖动查看：先放大到 200%，再按住往左上拖
await evaluate('for (let i = 0; i < 6; i += 1) document.getElementById("lightbox-zoom-in").click();');
await sleep(200);
const beforeDrag = await evaluate(`(() => { const stage = document.getElementById("lightbox-stage"); return { left: stage.scrollLeft, top: stage.scrollTop, sw: stage.scrollWidth, cw: stage.clientWidth, sh: stage.scrollHeight, ch: stage.clientHeight }; })()`);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 700, y: 500, button: "left", buttons: 1, clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 620, y: 440, button: "left", buttons: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 520, y: 380, button: "left", buttons: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 520, y: 380, button: "left", buttons: 0, clickCount: 1 });
await sleep(250);
const afterDrag = await evaluate(`(() => { const stage = document.getElementById("lightbox-stage"); return { left: stage.scrollLeft, top: stage.scrollTop }; })()`);

const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
fs.writeFileSync(path.join(process.cwd(), ".shots", "lightbox-open.png"), Buffer.from(shot.data, "base64"));

// 6. Esc 关闭
await pressEscape();
const afterEscape = await evaluate(`({ hidden: document.getElementById("cover-lightbox").hidden, bodyClass: document.body.classList.contains("lightbox-open"), src: document.getElementById("lightbox-img").getAttribute("src") })`);

// 7. 文字封面兜底（Python 3 速查手册没有封面图）
await send("Page.navigate", { url: `${origin}/?book=coding-python3` });
await waitFor('!!document.querySelector("#sheet .cover-visual")', "python3 cover visual");
await sleep(500);
const noImagePoint = await coverClickPoint();
const fallbackOpened = await openCover(noImagePoint);

const fallbackState = await evaluate(`(() => {
  const fb = document.getElementById("lightbox-fallback");
  const card = fb.querySelector(".lightbox-fallback-cover");
  return {
    hidden: document.getElementById("cover-lightbox").hidden,
    fallbackHidden: fb.hidden,
    imgHidden: document.getElementById("lightbox-img").hidden,
    imgSrc: document.getElementById("lightbox-img").getAttribute("src"),
    title: document.getElementById("lightbox-title").textContent,
    series: card ? card.querySelector("small").textContent : "",
    name: card ? card.querySelector("strong").textContent : "",
    sub: card ? card.querySelector("span").textContent : "",
    author: card ? card.querySelector("em").textContent : "",
    cardSize: card ? (() => { const r = card.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
  };
})()`);

const fallbackShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
fs.writeFileSync(path.join(process.cwd(), ".shots", "lightbox-fallback.png"), Buffer.from(fallbackShot.data, "base64"));

await pressEscape();
const fallbackClosed = await evaluate('document.getElementById("cover-lightbox").hidden');

await send("Emulation.clearDeviceMetricsOverride");

console.log(JSON.stringify({
  coverPoint,
  coverOpened,
  opened,
  afterButtons,
  afterWheel,
  atMin,
  beforeDrag,
  afterDrag,
  afterEscape,
  noImagePoint,
  fallbackOpened,
  fallbackState,
  fallbackClosed,
  consoleErrors: consoleMessages,
  exceptions,
}, null, 2));
socket.close();
