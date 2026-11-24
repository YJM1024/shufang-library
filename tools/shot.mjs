// 截图工具：连本机 CDP（9222），按选择器滚到目标位置后截整屏。
// 用法：node tools/shot.mjs <url> <out.png> [--scroll selector] [--offset px] [--width 1600] [--height 1000]
const endpoint = "http://127.0.0.1:9222/json";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
if (!url || !out) {
  console.error("usage: node tools/shot.mjs <url> <out.png> [--scroll selector] [--offset px] [--width n] [--height n]");
  process.exit(2);
}

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

const width = Number(flag("width", 1600));
const height = Number(flag("height", 1000));
const scrollSelector = flag("scroll", null);
const offset = Number(flag("offset", 60));

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

async function waitFor(expression, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return;
    } catch {
      // context may be replaced by navigation
    }
    await sleep(120);
  }
  throw new Error(`timeout waiting for ${label}`);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url });
await waitFor('document.querySelectorAll("#sheet .chapter").length > 0', "book sheet");
await sleep(600);

if (scrollSelector) {
  const ok = await evaluate(`(() => {
    const reader = document.querySelector("#reader");
    const el = document.querySelector(${JSON.stringify(scrollSelector)});
    if (!reader || !el) return false;
    const top = el.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - ${offset};
    reader.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    return true;
  })()`);
  if (!ok) throw new Error(`missing selector: ${scrollSelector}`);
  await sleep(900);
}

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
const fs = await import("node:fs");
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));

const info = await evaluate(`(() => ({
  url: location.href,
  width: innerWidth,
  height: innerHeight,
  book: document.body.dataset.book || "",
  sections: document.querySelectorAll("#sheet .chapter, #sheet .cover-page").length,
  codeBlocks: document.querySelectorAll("#sheet .code-block").length,
  sheetTop: Math.round(document.querySelector("#sheet").getBoundingClientRect().top),
}))()`);

console.log(JSON.stringify({ out, bytes: fs.statSync(out).size, ...info, exceptions }, null, 2));
socket.close();
