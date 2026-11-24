const endpoint = "http://127.0.0.1:9222/json";

async function findPage() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const list = await (await fetch(endpoint)).json();
      const page = list.find((target) => target.type === "page");
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
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
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
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

await send("Runtime.enable");
await send("Page.enable");

let ready = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const result = await send("Runtime.evaluate", {
    expression: '!!document.querySelector("#book-list .book-card") && !document.querySelector("#app").hidden',
    returnByValue: true,
  });
  if (result.result.value) {
    ready = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
console.log("ready", ready);

const probe = `(() => {
  const pick = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height),
      display: style.display, visibility: style.visibility, opacity: style.opacity,
      position: style.position, overflow: style.overflow, flex: style.flex,
      zIndex: style.zIndex, background: style.backgroundColor,
      top: style.top, height: style.height, marginBottom: style.marginBottom,
    };
  };
  return {
    innerWidth,
    docClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    readerScroll: document.querySelector("#reader").scrollTop,
    app: pick("#app"),
    reader: pick("#reader"),
    bar: pick(".reader-bar"),
    mask: pick(".reader-mask"),
    sheet: pick(".sheet"),
    left: pick(".bar-left"),
    right: pick(".bar-right"),
    section: pick(".bar-section"),
    settings: pick("#btn-settings"),
    theme: pick("#btn-theme"),
    book: pick(".bar-book"),
    progress: pick(".bar-progress"),
    drawerBooks: pick("#btn-books"),
  };
})()`;

const result = await send("Runtime.evaluate", {
  expression: probe,
  returnByValue: true,
  awaitPromise: true,
});
console.log(JSON.stringify(result.result.value, null, 2));
socket.close();
