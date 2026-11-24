// 代码块验收：结构、高亮 token、复制按钮、计算样式、430 布局。
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

await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Browser.grantPermissions", {
  origin: "http://127.0.0.1:6187",
  permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
});
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:6187/?book=dsh-deepdive" });
await waitFor('document.querySelectorAll("#sheet .code-block").length === 16', "dsh code blocks");
await sleep(500);

const structure = await evaluate(`(() => {
  const blocks = [...document.querySelectorAll("#sheet .code-block")];
  const first = blocks[0];
  const pre = first.querySelector("pre");
  const code = first.querySelector("pre code");
  const figure = getComputedStyle(first);
  const preStyle = getComputedStyle(pre);
  const codeStyle = getComputedStyle(code);
  const copyBtn = first.querySelector(".code-copy");
  const langs = blocks.map((block) => block.querySelector(".code-lang").textContent);
  const prose = document.querySelector("#ch-03 .chapter-intro");
  const extraProse = document.querySelector("#ch-01 .q-extra .prose");
  const proseStyle = prose ? getComputedStyle(prose) : null;
  const extraStyle = extraProse ? getComputedStyle(extraProse) : null;
  return {
    count: blocks.length,
    languages: [...new Set(langs)],
    tokens: first.querySelectorAll("span[class^='tok-']").length,
    tokenClasses: [...new Set([...document.querySelectorAll("#sheet .code-block span[class^='tok-']")].map((el) => el.className))].sort(),
    figureBg: figure.backgroundColor,
    figureBorder: figure.borderTopColor,
    preFont: preStyle.fontFamily.split(",")[0],
    preSize: preStyle.fontSize,
    preLineHeight: preStyle.lineHeight,
    preWhiteSpace: preStyle.whiteSpace,
    codeColor: codeStyle.color,
    barText: first.querySelector(".code-lang").textContent,
    copyLabel: copyBtn.textContent,
    copyVisible: copyBtn.getBoundingClientRect().width > 20,
    proseFont: proseStyle ? proseStyle.fontFamily.split(",")[0] : null,
    proseSize: proseStyle ? proseStyle.fontSize : null,
    proseLineHeight: proseStyle ? proseStyle.lineHeight : null,
    extraProseFont: extraStyle ? extraStyle.fontFamily.split(",")[0] : null,
    extraProseSize: extraStyle ? extraStyle.fontSize : null,
    chapter3: !!document.querySelector("#ch-03"),
    qExtra1: document.querySelectorAll("#ch-01 .q-extra").length,
    prose1: document.querySelectorAll("#ch-01 .prose").length,
    proseGlobal: document.querySelectorAll("#sheet .prose").length,
    inlinePre: !!document.querySelector("#sheet .q-extra > pre"),
    rawFenceText: (document.querySelector("#sheet").textContent.match(/\`\`\`/g) || []).length,
  };
})()`);

const copyResult = await evaluate(`(async () => {
  const block = document.querySelector("#sheet .code-block");
  const codeEl = block.querySelector("pre code");
  const expected = codeEl.textContent;
  const button = block.querySelector(".code-copy");
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 260));
  let clipboard = null;
  try {
    clipboard = await navigator.clipboard.readText();
  } catch (error) {
    clipboard = "READ_FAILED: " + error.message;
  }
  const normalize = (value) => String(value).replace(/\\r\\n/g, "\\n");
  const clipboardText = normalize(clipboard);
  const expectedText = normalize(expected);
  let diff = -1;
  for (let i = 0; i < Math.min(clipboardText.length, expectedText.length); i += 1) {
    if (clipboardText[i] !== expectedText[i]) { diff = i; break; }
  }
  return {
    label: button.textContent,
    done: button.classList.contains("is-done"),
    matches: clipboardText === expectedText,
    crlf: clipboard.includes("\\r\\n"),
    clipboardLength: clipboard.length,
    expectedLength: expected.length,
    diff,
    clipboardAround: diff >= 0 ? clipboardText.slice(Math.max(0, diff - 20), diff + 60) : "",
    expectedAround: diff >= 0 ? expectedText.slice(Math.max(0, diff - 20), diff + 60) : "",
    clipboardTail: clipboardText.slice(-40),
    expectedTail: expectedText.slice(-40),
  };
})()`);

await sleep(1500);
const copyReset = await evaluate(`(() => { const button = document.querySelector("#sheet .code-block .code-copy"); return { label: button.textContent, done: button.classList.contains("is-done") }; })()`);

await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);
const mobile = await evaluate(`(() => {
  const reader = document.querySelector("#reader");
  const el = document.querySelector("#ch-03 .code-block");
  const top = el.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 70;
  reader.scrollTo({ top, behavior: "auto" });
  const block = el.getBoundingClientRect();
  const pre = el.querySelector("pre");
  const style = getComputedStyle(pre);
  return {
    innerWidth,
    block: { x: Math.round(block.x), y: Math.round(block.y), w: Math.round(block.width), h: Math.round(block.height) },
    preSize: style.fontSize,
    prePadding: style.padding,
    font: style.fontFamily.split(",")[0],
    overflowX: el.scrollWidth > el.clientWidth,
  };
})()`);
await sleep(400);
const mobileShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
fs.writeFileSync(path.join(process.cwd(), ".shots", "mobile-code-430.png"), Buffer.from(mobileShot.data, "base64"));
await send("Emulation.clearDeviceMetricsOverride");

console.log(JSON.stringify({ structure, copyResult, copyReset, mobile, consoleErrors: consoleMessages, exceptions }, null, 2));
socket.close();
