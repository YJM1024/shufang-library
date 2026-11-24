import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");
const STATE_DIR = path.join(path.dirname(ROOT), "state");
const STATE_FILE = path.join(STATE_DIR, "library.json");
const PORT = Number(process.env.PORT || 6187);
const HOST = "127.0.0.1";
const MAX_BODY = 2 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function send(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("state body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function handleState(request, response) {
  if (request.method === "GET" || request.method === "HEAD") {
    if (!fs.existsSync(STATE_FILE)) {
      send(response, 404, JSON.stringify({ error: "no state" }), "application/json; charset=utf-8");
      return;
    }
    const body = fs.readFileSync(STATE_FILE, "utf8");
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? "" : body);
    return;
  }

  if (request.method === "PUT" || request.method === "POST") {
    const raw = await readBody(request);
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      send(response, 400, JSON.stringify({ error: "invalid json" }), "application/json; charset=utf-8");
      return;
    }
    if (!data || typeof data !== "object" || !data.books || typeof data.books !== "object") {
      send(response, 400, JSON.stringify({ error: "invalid state" }), "application/json; charset=utf-8");
      return;
    }
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const temp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(temp, STATE_FILE);
    send(response, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
    return;
  }

  send(response, 405, "Method not allowed");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === "/api/state") {
      await handleState(request, response);
      return;
    }

    if (pathname === "/" || pathname === "") pathname = "/index.html";

    const filePath = path.resolve(ROOT, `.${pathname}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      send(response, 403, "Forbidden");
      return;
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      send(response, 404, `Not found: ${pathname}`);
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const type = MIME[extension] || "application/octet-stream";
    const stat = fs.statSync(filePath);

    response.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    console.error(error);
    send(response, 500, "Internal error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`书房: http://${HOST}:${PORT}`);
  console.log(`state: ${STATE_FILE}`);
});
