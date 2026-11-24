import fs from "node:fs";
import path from "node:path";

const root = "E:/dsh_home/workspaces/common/library/site";
const index = JSON.parse(fs.readFileSync(path.join(root, "data/books.json"), "utf8"));
console.log("books", index.books.length, index.books.map((book) => `${book.id}:${book.chapters}`).join(" "));

const book = JSON.parse(fs.readFileSync(path.join(root, "data/book-a2a.json"), "utf8"));
console.log("keys", Object.keys(book));
console.log("meta", JSON.stringify({
  title: book.meta.title,
  count: book.meta.count,
  modules: book.meta.modules,
  accent: book.meta.accent,
  startTarget: book.meta.startTarget,
  barcode: book.meta.barcode,
  cover: book.meta.cover,
  coverThumb: book.meta.coverThumb,
}));
console.log("front", book.front.map((section) => `${section.id}:${section.title}:${section.html.length}`));
console.log("chapters", book.chapters.map((chapter) => `${chapter.id}|${chapter.num}|${chapter.title}|${chapter.count}|${chapter.qRange}|${chapter.words}|${chapter.html.length}`));
console.log("coverHtml", book.coverHtml.slice(0, 700));
console.log("chapter1", book.chapters[0].html.slice(0, 900));
console.log(
  "files",
  fs.readdirSync(path.join(root, "assets")).join(","),
  fs.readdirSync(path.join(root, "assets/covers")).length,
  fs.readdirSync(path.join(root, "assets/figs")).length,
);
