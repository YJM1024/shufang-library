import fs from 'node:fs';
import path from 'node:path';

const SOURCE_ROOT = 'E:/dsh_home/workspaces/ai';
const LIBRARY_ROOT = path.resolve(import.meta.dirname, '..');
const DEST_ROOT = path.join(LIBRARY_ROOT, 'books');

// Curated shelf order. The first book is what the demo opens with.
const ORDER = [
  'a2a',
  'context-eng',
  'memory',
  'agent-arch',
  'rag-interview',
  'eval',
  'agent-sys-design',
];

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return { copied: false, bytes: 0, missing: src };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return { copied: true, bytes: fs.statSync(dest).size };
}

function figureName(key) {
  return `fig-${String(key).replace(':', '-')}.png`;
}

const manifest = [];
let totalBytes = 0;
let totalFiles = 0;
let totalFigures = 0;

for (const id of ORDER) {
  const srcDir = path.join(SOURCE_ROOT, id);
  const destDir = path.join(DEST_ROOT, id);
  const bookPath = path.join(srcDir, 'publish', 'book.json');
  if (!fs.existsSync(bookPath)) {
    console.error(`[skip] ${id}: no publish/book.json`);
    continue;
  }
  const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));

  // The manifest itself and all files it references, kept at their original
  // relative paths so the copied book remains a valid source tree.
  const files = ['publish/book.json', book.front, book.cover, ...(book.chapters || [])].filter(Boolean);
  let bookBytes = 0;
  for (const rel of files) {
    const result = copyFile(path.join(srcDir, rel), path.join(destDir, rel));
    if (result.copied) {
      bookBytes += result.bytes;
      totalFiles += 1;
    } else {
      console.warn(`[missing] ${id}/${rel}`);
    }
  }

  // Figures referenced by question extras, plus the ISBN barcode.
  const figureFiles = new Set();
  for (const extras of Object.values(book.extras || {})) {
    for (const item of extras || []) {
      if (Array.isArray(item) && item[0] === 'fig' && item[1]) {
        figureFiles.add(figureName(item[1]));
      }
    }
  }
  figureFiles.add('barcode.png');
  for (const name of figureFiles) {
    const result = copyFile(
      path.join(srcDir, 'publish', 'figs', name),
      path.join(destDir, 'publish', 'figs', name),
    );
    if (result.copied) {
      bookBytes += result.bytes;
      totalFigures += 1;
      totalFiles += 1;
    } else {
      console.warn(`[missing] ${id}/publish/figs/${name}`);
    }
  }

  totalBytes += bookBytes;
  manifest.push({
    id,
    title: book.title,
    subtitle: book.subtitle,
    count: book.count,
    chapters: (book.chapters || []).length,
    accent: (book.theme && book.theme[0] && book.theme[0].main) || '#1C1A17',
    light: (book.theme && book.theme[0] && book.theme[0].light) || '#F2ECDF',
    manifest: 'publish/book.json',
    front: book.front,
    cover: book.cover,
    figures: [...figureFiles],
    source: srcDir,
  });
  console.log(`[copy] ${id.padEnd(16)} files=${String(files.length + figureFiles.size).padStart(2)} bytes=${(bookBytes / 1024 / 1024).toFixed(1)}MB`);
}

fs.mkdirSync(DEST_ROOT, { recursive: true });
fs.writeFileSync(
  path.join(DEST_ROOT, 'manifest.json'),
  JSON.stringify({ order: manifest.map((b) => b.id), books: manifest }, null, 2),
  'utf8',
);

console.log(`\nCopied ${manifest.length} books, ${totalFiles} files, ${totalFigures} figures, ${(totalBytes / 1024 / 1024).toFixed(1)}MB total.`);
console.log(`Manifest: ${path.join(DEST_ROOT, 'manifest.json')}`);
