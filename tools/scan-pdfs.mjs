import fs from "node:fs";
import path from "node:path";

const SPILL = "C:/Users/YJM1024/AppData/Local/Temp/dsh-spill-DlNAhV/session-18926df59440/161e2d3ee907-glob-results.txt";
const ROOT = "E:/dsh_home/workspaces";
const LIB = "E:/dsh_home/workspaces/common/library";
const BOOKS = ["a2a", "context-eng", "memory", "agent-arch", "rag-interview", "eval", "agent-sys-design"];

const lines = fs.readFileSync(SPILL, "utf8").split(/\r?\n/).filter((x) => x.trim());
const rows = [];
for (const file of lines) {
  let stat;
  try { stat = fs.statSync(file); } catch { continue; }
  if (!stat.isFile()) continue;
  const rel = path.relative(ROOT, file);
  const parts = rel.split(path.sep);
  const top = parts[0] || "";
  const name = parts[parts.length - 1] || "";
  let category = "other";
  if (top === "ai") {
    const book = parts[1] || "";
    if (book === "src" || /_probe|test|draft|sample/i.test(name)) category = "test";
    else if (book === "agent-deep") category = parts.includes("archive") ? "book-old" : "book";
    else if (BOOKS.includes(book)) category = parts.includes("archive") ? "book-old" : "book";
    else category = "ai-other";
  } else if (top === "agent") {
    category = "test";
  } else if (top === "theory") {
    if (/[\\/]build[\\/]zhihu[\\/](book[\\/]ch_|report[\\/]rd_ch_|compendium[\\/]design[\\/]m_)/.test(rel)) category = "intermediate";
    else if (/[\\/]build[\\/]zhihu[\\/]site[\\/]assets[\\/]/.test(rel)) category = "duplicate";
    else category = "research";
  } else if (top === "coding") {
    category = /[\\/]docs[\\/]/.test(rel) ? "coding" : "test";
  }
  rows.push({
    category,
    book: top === "ai" ? (parts[1] || "") : top,
    name,
    path: file,
    rel,
    size: stat.size,
    modified: stat.mtime.toISOString(),
  });
}

const order = ["book", "book-old", "research", "coding", "other", "intermediate", "duplicate", "test", "ai-other"];
const sizeOf = (r) => r.size;
const sum = (a) => a.reduce((s, r) => s + sizeOf(r), 0);
const fmt = (n) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
const cats = [...new Set(rows.map((r) => r.category))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
const byCat = Object.fromEntries(cats.map((c) => [c, rows.filter((r) => r.category === c)]));

const csvEsc = (s) => `"${String(s).replaceAll('"', '""')}"`;
const csv = ["category,book,name,size_bytes,modified,path", ...rows.map((r) => [r.category, r.book, r.name, r.size, r.modified, r.path].map(csvEsc).join(","))].join("\r\n");
fs.writeFileSync(path.join(LIB, "INVENTORY.csv"), csv + "\r\n", "utf8");

// Unused drawings in the seven book projects plus agent-deep.
const imageRows = [];
const usedNames = new Map();
for (const id of BOOKS) {
  const dir = path.join(LIB, "books", id, "publish", "figs");
  const set = new Set();
  if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) set.add(n);
  usedNames.set(id, set);
}
const refCover = new Map();
for (const id of [...BOOKS, "agent-deep"]) {
  const bp = path.join(ROOT, "ai", id, "publish", "book.json");
  if (fs.existsSync(bp)) {
    try { refCover.set(id, path.basename(JSON.parse(fs.readFileSync(bp, "utf8")).cover || "")); } catch {}
  }
}
function walkImages(base, out) {
  if (!fs.existsSync(base)) return;
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
    const p = path.join(base, ent.name);
    if (ent.isDirectory()) walkImages(p, out);
    else if (/\.(png|jpe?g|webp|svg)$/i.test(ent.name)) {
      const st = fs.statSync(p);
      out.push({ name: ent.name, path: p, rel: path.relative(ROOT, p), size: st.size, modified: st.mtime.toISOString() });
    }
  }
}
for (const id of [...BOOKS, "agent-deep"]) {
  const whole = [];
  walkImages(path.join(ROOT, "ai", id), whole);
  for (const img of whole) {
    const rel = img.rel.replaceAll("\\", "/");
    let kind = "other";
    if (/\/publish\/cover\//.test(rel)) kind = "cover";
    else if (/\/publish\/figs\//.test(rel)) kind = "figure";
    else if (/\/design\//.test(rel)) kind = "design";
    else if (/\/frontmatter\//.test(rel)) kind = "frontmatter";
    const used = kind === "figure" ? usedNames.get(id)?.has(img.name) : false;
    imageRows.push({ book: id, kind, used, ...img });
  }
}
const imgByBook = {};
for (const r of imageRows) (imgByBook[r.book] ??= []).push(r);

const md = [];
md.push("# 资料馆清单（PDF / 绘画）", "");
md.push(`生成时间：${new Date().toISOString()}。扫描根目录：\`${ROOT}\`。原始 PDF 共 ${rows.length} 个，总体积 ${fmt(sum(rows))}。完整逐文件清单在 \`INVENTORY.csv\`。`, "");
md.push("## PDF 总览", "");
md.push("| 类别 | 数量 | 体积 | 建议 |", "|---|---:|---:|---|");
const advice = {
  book: "纳入书库（成品）",
  "book-old": "归档，默认不入站",
  research: "纳入资料馆（精选）",
  coding: "纳入资料馆（精选）",
  other: "纳入资料馆（单篇）",
  intermediate: "只登记，不入站",
  duplicate: "去重后忽略",
  test: "测试/构建产物，不入站",
  "ai-other": "待人工判断",
};
for (const c of cats) md.push(`| ${c} | ${byCat[c].length} | ${fmt(sum(byCat[c]))} | ${advice[c] || "待定"} |`);
md.push("");

md.push("## 书稿成品（T1）", "");
const bookRows = [...byCat.book || [], ...byCat["book-old"] || []];
if (bookRows.length) {
  md.push("| 书 | 文件 | 体积 | 修改时间 | 备注 |", "|---|---|---:|---|---|");
  for (const r of bookRows) md.push(`| ${r.book} | ${r.name} | ${fmt(r.size)} | ${r.modified.slice(0, 10)} | ${r.category === "book-old" ? "旧版/归档" : "成品"} |`);
} else md.push("没有找到题库书的成品 PDF。");
md.push("");

md.push("## 研究/课程资料（T2 精选）", "");
const researchRows = [...(byCat.research || []), ...(byCat.coding || []), ...(byCat.other || [])];
const uniqueResearch = [];
const seen = new Set();
for (const r of researchRows) {
  const key = `${r.name}|${r.size}`;
  if (seen.has(key)) continue;
  seen.add(key);
  uniqueResearch.push(r);
}
md.push(`按文件名与体积去重后 ${uniqueResearch.length} 个（原始 ${researchRows.length} 个）。`);
md.push("", "| 来源 | 文件 | 体积 | 修改时间 |", "|---|---|---:|---|");
for (const r of uniqueResearch) md.push(`| ${r.book} | ${r.name} | ${fmt(r.size)} | ${r.modified.slice(0, 10)} |`);
md.push("");

md.push("## 中间稿与重复（T3，默认不入站）", "");
const t3 = [...(byCat.intermediate || []), ...(byCat.duplicate || [])];
md.push(`共 ${t3.length} 个，${fmt(sum(t3))}。包括 theory 的按章 PDF、compendium 的设计稿、site/assets 下的重复副本。`);
md.push("");

md.push("## 测试/构建产物（T4，默认不入站）", "");
md.push(`共 ${(byCat.test || []).length} 个，${fmt(sum(byCat.test || []))}。绝大多数是 agent 工作区里按会话复制的 \`m12-test.pdf\`，以及 coding 的 sample/draft/partial。`);
md.push("");

md.push("## 绘画/配图", "");
for (const id of [...BOOKS, "agent-deep"]) {
  const list = imgByBook[id] || [];
  if (!list.length) continue;
  md.push(`### ${id}`, "");
  md.push(`共 ${list.length} 张，${fmt(sum(list))}。`);
  md.push("", "| 类别 | 文件 | 体积 | 已在网站 |", "|---|---|---:|---|");
  for (const r of list) md.push(`| ${r.kind} | ${r.name} | ${fmt(r.size)} | ${r.used ? "是" : "否"} |`);
  md.push("");
}
md.push("## 入站建议", "");
md.push("1. 书稿成品只收 `book`，旧版放归档，不占阅读入口。");
md.push("2. 研究/课程资料按去重后的 T2 精选入“资料馆”，测试/中间稿不进站，仅在 CSV 留底。");
md.push("3. 绘画先收每本一张最终封面和已使用的配图；封面草稿、设计样张、back_bg 放“设计稿”分区，是否公开单独决定。");
md.push("4. 题库七本当前没有成品 PDF，网站已是它们的正式呈现；PDF 这一步要么从同源导出，要么只把 agent-deep 等已有 PDF 入馆。");
md.push("");
fs.writeFileSync(path.join(LIB, "INVENTORY.md"), md.join("\n"), "utf8");

console.log(JSON.stringify({
  totalPdf: rows.length,
  totalSize: sum(rows),
  categories: Object.fromEntries(cats.map((c) => [c, { count: byCat[c].length, size: sum(byCat[c]) }])),
  uniqueResearch: uniqueResearch.length,
  images: imageRows.length,
  imageSize: sum(imageRows),
}, null, 2));
