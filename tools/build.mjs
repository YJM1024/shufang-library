import fs from 'node:fs';
import path from 'node:path';
import { highlight, languageLabel, normalizeLanguage } from './highlight.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'books');
const SRC_DIR = path.join(ROOT, 'src');
const SITE_DIR = path.join(ROOT, 'site');

const warnings = [];

function warn(message) {
  warnings.push(message);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(value) {
  let text = esc(value);
  const codes = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  text = text.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
  return text;
}

const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;

function needsSpace(left, right) {
  if (/[*_`]$/.test(left)) return true;
  const a = left.slice(-1);
  const b = right[0] || '';
  return !(CJK.test(a) || CJK.test(b));
}

function joinLines(lines) {
  let out = '';
  for (const line of lines) {
    const text = String(line).trim();
    if (!text) continue;
    out += out ? (needsSpace(out, text) ? ' ' : '') + text : text;
  }
  return out;
}

function formatInt(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function stripChapterPrefix(title) {
  return String(title)
    .replace(/^[一二三四五六七八九十百]+、\s*/, '')
    .replace(/^\d{1,2}[.、．]?\s+/, '')
    .trim();
}

function sectionKicker(title) {
  if (/内容提要/.test(title)) return 'SUMMARY';
  if (/序言|前言/.test(title)) return 'PREFACE';
  if (/后记/.test(title)) return 'AFTERWORD';
  return 'FRONT MATTER';
}

function countWords(markdown) {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '');
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]+/g) || []).length;
  return cjk + latin;
}

function parseTableFromLines(lines) {
  const start = lines.findIndex((line) => /^\s*\|/.test(line));
  if (start === -1) return null;
  const tableLines = [];
  for (let i = start; i < lines.length; i += 1) {
    if (/^\s*\|/.test(lines[i])) tableLines.push(lines[i]);
    else if (tableLines.length) break;
  }
  if (tableLines.length < 2) return null;
  const separator = tableLines[1];
  if (!/^[\s|:\-]+$/.test(separator) || !separator.includes('-')) return null;
  const parseRow = (line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  return {
    header: parseRow(tableLines[0]),
    rows: tableLines.slice(2).map(parseRow),
  };
}

function parseDefinition(text) {
  const match = String(text).match(/^\*\*(.+?)\*\*\s*[：:]\s*([\s\S]+)$/);
  if (!match) return null;
  return { term: match[1].trim(), def: match[2].trim() };
}

function parseBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim()) continue;

    if (/^```/.test(raw.trim())) {
      const language = raw.trim().slice(3).trim();
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', language, text: code.join('\n') });
      continue;
    }

    if (/^\s*\|/.test(raw)) {
      const tableLines = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      i -= 1;
      const table = parseTableFromLines(tableLines);
      if (table) blocks.push({ type: 'table', ...table });
      else blocks.push({ type: 'p', text: joinLines(tableLines) });
      continue;
    }

    if (/^#{3,6}\s+/.test(raw)) {
      const level = raw.match(/^(#{3,6})/)[1].length;
      const text = raw.replace(/^#{3,6}\s+/, '').trim();
      blocks.push({ type: level === 3 ? 'h3' : 'h4', text });
      continue;
    }

    if (/^\s*[-*]\s+/.test(raw)) {
      const items = [];
      while (i < lines.length) {
        const match = lines[i].match(/^\s*[-*]\s+(.*)$/);
        if (!match) break;
        let item = match[1].trim();
        i += 1;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) {
          const continuation = lines[i].trim();
          item += needsSpace(item, continuation) ? ` ${continuation}` : continuation;
          i += 1;
        }
        items.push(item);
        let next = i;
        while (next < lines.length && !lines[next].trim()) next += 1;
        if (next < lines.length && /^\s*[-*]\s+/.test(lines[next])) {
          i = next;
          continue;
        }
        break;
      }
      i -= 1;
      const definitions = items.map(parseDefinition);
      if (items.length >= 2 && definitions.every(Boolean)) {
        blocks.push({ type: 'defs', items: definitions });
      } else {
        blocks.push({ type: 'list', items });
      }
      continue;
    }

    if (/^\s*\d+\.\s+/.test(raw)) {
      const items = [];
      let start = 1;
      while (i < lines.length) {
        const match = lines[i].match(/^\s*(\d+)\.\s+(.*)$/);
        if (!match) break;
        if (items.length === 0) start = Number(match[1]);
        let item = match[2].trim();
        i += 1;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
          const continuation = lines[i].trim();
          item += needsSpace(item, continuation) ? ` ${continuation}` : continuation;
          i += 1;
        }
        items.push(item);
        let next = i;
        while (next < lines.length && !lines[next].trim()) next += 1;
        if (next < lines.length && /^\s*\d+\.\s+/.test(lines[next])) {
          i = next;
          continue;
        }
        break;
      }
      i -= 1;
      blocks.push({ type: 'ol', items, start });
      continue;
    }

    if (/^>\s?/.test(raw)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'quote', text: joinLines(quoteLines) });
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(raw)) {
      blocks.push({ type: 'hr' });
      continue;
    }

    const paragraph = [raw];
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (!next.trim()) break;
      if (/^(#{1,6}\s|```|\s*[-*]\s+|\s*\d+\.\s+|>|\s*\|)/.test(next)) break;
      paragraph.push(next);
      i += 1;
    }
    blocks.push({ type: 'p', text: joinLines(paragraph) });
  }

  return blocks;
}

function renderBlock(block) {
  switch (block.type) {
    case 'p':
      return `<p>${inline(block.text)}</p>`;
    case 'list':
      return `<ul>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
    case 'ol':
      return `<ol${block.start && block.start !== 1 ? ` start="${block.start}"` : ''}>${block.items
        .map((item) => `<li>${inline(item)}</li>`)
        .join('')}</ol>`;
    case 'defs':
      return `<dl class="concepts">${block.items
        .map((item) => `<div class="concept"><dt>${inline(item.term)}</dt><dd>${inline(item.def)}</dd></div>`)
        .join('')}</dl>`;
    case 'table':
      return `<div class="table-wrap"><table><thead><tr>${block.header
        .map((cell) => `<th>${inline(cell)}</th>`)
        .join('')}</tr></thead><tbody>${block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`;
    case 'quote':
      return `<blockquote><p>${inline(block.text)}</p></blockquote>`;
    case 'code': {
      const lang = normalizeLanguage(block.language);
      const label = languageLabel(lang);
      return `<figure class="code-block" data-lang="${esc(lang)}"><figcaption class="code-bar"><span class="code-lang">${esc(label)}</span><button type="button" class="code-copy" data-copy>复制</button></figcaption><pre><code class="language-${esc(lang)}">${highlight(block.text, lang)}</code></pre></figure>`;
    }
    case 'h3':
      return `<h4>${inline(block.text)}</h4>`;
    case 'h4':
      return `<h5>${inline(block.text)}</h5>`;
    case 'hr':
      return '<hr>';
    default:
      return '';
  }
}

function renderBlocks(blocks) {
  return blocks.map(renderBlock).join('');
}

function parseQuestionHeading(heading) {
  const match = String(heading).match(/^(Q\d+)\s*[｜|]\s*(L\d)\s*[｜|]\s*([★☆]+)\s*[｜|]\s*([\s\S]*)$/);
  if (!match) return null;
  return {
    id: match[1],
    level: match[2],
    stars: match[3],
    title: match[4].trim(),
  };
}

function parseChapterBody(body) {
  const parts = String(body).replace(/\r\n/g, '\n').split(/^###\s+/m);
  const introMd = parts[0].trim();
  const items = [];
  for (const part of parts.slice(1)) {
    const newline = part.indexOf('\n');
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const content = newline === -1 ? '' : part.slice(newline + 1).trim();
    const question = parseQuestionHeading(heading);
    if (question) {
      items.push({
        type: 'question',
        question: { ...question, body: content, blocks: parseBlocks(content) },
      });
    } else {
      items.push({
        type: 'extra',
        title: heading,
        html: renderBlocks(parseBlocks(content)),
      });
    }
  }
  return { introMd, items };
}

function questionsOf(chapter) {
  return chapter.items.filter((item) => item.type === 'question').map((item) => item.question);
}

function insightOf(question) {
  if (!question) return '';
  const blocks = question.blocks.slice();
  if (blocks[0] && (blocks[0].type === 'defs' || blocks[0].type === 'list')) {
    blocks.shift();
    if (blocks[0] && blocks[0].type === 'p') return blocks[0].text;
  }
  return '';
}

function rangeOf(questions) {
  if (!questions.length) return '';
  const first = questions[0].id;
  const last = questions[questions.length - 1].id;
  return first === last ? first : `${first}–${last}`;
}

function chapterSections(chapter) {
  return chapter.items
    .filter((item) => item.type === 'question')
    .map((item) => ({
      id: `q-${item.question.id}`,
      qno: item.question.id,
      title: item.question.title,
    }));
}

function parseFront(raw) {
  const parts = String(raw).replace(/\r\n/g, '\n').split(/^##\s+/m);
  const sections = parts.slice(1).map((part) => {
    const newline = part.indexOf('\n');
    return {
      title: (newline === -1 ? part : part.slice(0, newline)).trim(),
      body: newline === -1 ? '' : part.slice(newline + 1).trim(),
    };
  });
  const mapSection = sections.find((section) => /题库地图/.test(section.title));
  const backSection = sections.find((section) => /封底/.test(section.title));
  const keywordSection = sections.find((section) => /关键词/.test(section.title));
  const frontSections = sections.filter(
    (section) => section !== mapSection && section !== backSection && section !== keywordSection,
  );

  let mapRows = [];
  if (mapSection) {
    const table = parseTableFromLines(mapSection.body.split('\n'));
    if (table) {
      mapRows = table.rows.map((row) => ({
        name: row[0] || '',
        range: row[1] || '',
        count: Number((row[2] || '').replace(/[^\d]/g, '')) || 0,
        lead: row[3] || '',
      }));
    } else {
      warn('front matter: 题库地图 found but no table parsed');
    }
  }

  const backMap = {};
  if (backSection) {
    for (const part of backSection.body.split(/^###\s+/m).slice(1)) {
      const newline = part.indexOf('\n');
      const title = (newline === -1 ? part : part.slice(0, newline)).trim();
      backMap[title] = newline === -1 ? '' : part.slice(newline + 1).trim();
    }
  }
  const keywords = keywordSection
    ? keywordSection.body
        .split(/[｜|]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  return {
    sections: frontSections,
    mapRows,
    back: {
      main: joinLines((backMap['主文案'] || '').split('\n')),
      sub: joinLines((backMap['副文案'] || '').split('\n')),
      introMd: backMap['简介'] || '',
      audienceMd: backMap['适合谁读'] || '',
    },
    keywords,
  };
}

function makeChapter(title, body, sequence, mapRow, file, synthetic = false) {
  const parsed = parseChapterBody(body);
  let extraNo = 0;
  for (const item of parsed.items) {
    if (item.type !== 'extra') continue;
    extraNo += 1;
    item.id = `s-${String(sequence).padStart(2, '0')}-${String(extraNo).padStart(2, '0')}`;
  }
  return {
    id: `ch-${String(sequence).padStart(2, '0')}`,
    num: String(sequence).padStart(2, '0'),
    title: stripChapterPrefix(title) || title,
    rawTitle: title,
    file,
    mapRow,
    items: parsed.items,
    introHtml: renderBlocks(parseBlocks(parsed.introMd)),
    tailHtml: '',
    words: countWords(body),
    synthetic,
  };
}

function parseChapters(dir, book, mapRows) {
  const chapters = [];
  let last = null;
  let sequence = 0;

  for (const file of book.chapters || []) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    const parts = raw.split(/^##\s+/m);
    const preamble = parts[0].trim();

    if (preamble) {
      const pre = parseChapterBody(preamble);
      if (last) {
        last.items.push(...pre.items);
        last.tailHtml += renderBlocks(parseBlocks(pre.introMd));
        last.words += countWords(preamble);
        warn(`${book.title}: ${file} 的前置内容已接在 ${last.id}「${last.title}」之后（${pre.items.length} 段）`);
      } else if (pre.items.length || pre.introMd) {
        const chapter = makeChapter('卷首', preamble, 0, null, file, true);
        chapters.push(chapter);
        last = chapter;
        warn(`${book.title}: ${file} 的前置内容没有上一章，已单独成章「卷首」`);
      }
    }

    for (const part of parts.slice(1)) {
      const newline = part.indexOf('\n');
      const title = (newline === -1 ? part : part.slice(0, newline)).trim();
      const body = newline === -1 ? '' : part.slice(newline + 1);
      sequence += 1;
      const chapter = makeChapter(title, body, sequence, mapRows[sequence - 1] || null, file);
      chapters.push(chapter);
      last = chapter;
    }
  }

  for (const chapter of chapters) {
    const questions = questionsOf(chapter);
    chapter.count = questions.length;
    chapter.qRange = rangeOf(questions);
    chapter.lead = chapter.mapRow?.lead || insightOf(questions[0]) || '';
    if (chapter.mapRow && chapter.mapRow.count && chapter.mapRow.count !== chapter.count) {
      warn(
        `${book.title} ${chapter.id}「${chapter.title}」：题库地图写 ${chapter.mapRow.count} 题，实际解析 ${chapter.count} 题`,
      );
    }
  }

  return chapters;
}

function figureForQuestion(extrasByQuestion, questionId, questionTitle) {
  const figures = extrasByQuestion.get(questionId) || [];
  return figures
    .map(
      (figure) =>
        `<figure class="q-figure"><img loading="lazy" src="./${figure.src}" alt="${esc(
          `${questionId} 配图：${questionTitle}`,
        )}"><figcaption>${esc(figure.caption)}</figcaption></figure>`,
    )
    .join('');
}

function renderQuestion(question, figureHtml) {
  const blocks = question.blocks.slice();
  let concepts = null;
  let insight = null;
  if (blocks[0] && (blocks[0].type === 'defs' || blocks[0].type === 'list')) {
    concepts = blocks.shift();
    if (blocks[0] && blocks[0].type === 'p') insight = blocks.shift();
  }
  const conceptsHtml = concepts
    ? concepts.type === 'defs'
      ? renderBlock(concepts)
      : `<ul class="concepts-list">${concepts.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`
    : '';

  return `<article class="question" id="q-${question.id}" data-q="${question.id}">
  <header class="q-head">
    <div class="q-labels">
      <span class="q-no">${esc(question.id)}</span>
      <span class="q-level">${esc(question.level)}</span>
      <span class="q-stars" aria-label="难度 ${question.stars.length} 星">${esc(question.stars)}</span>
    </div>
    <h3 class="q-title">${inline(question.title)}</h3>
  </header>
  ${conceptsHtml}
  ${insight ? `<p class="insight">${inline(insight.text)}</p>` : ''}
  <div class="q-body">${renderBlocks(blocks)}</div>
  ${figureHtml}
</article>`;
}

function renderChapter(chapter, extrasByQuestion) {
  const metaParts = [];
  if (chapter.qRange) metaParts.push(chapter.qRange);
  if (chapter.count) metaParts.push(`${chapter.count} 题`);
  metaParts.push(`约 ${formatInt(chapter.words)} 字`);

  const body = chapter.items
    .map((item) =>
      item.type === 'question'
        ? renderQuestion(
            item.question,
            figureForQuestion(extrasByQuestion, item.question.id, item.question.title),
          )
        : `<section class="q-extra" id="${item.id}" data-extra="${item.id}"><h3>${inline(
            item.title,
          )}</h3><div class="prose">${item.html}</div></section>`,
    )
    .join('');

  return `<section class="chapter" id="${chapter.id}" data-section="${chapter.id}" data-chapter="${chapter.id}" data-label="${esc(chapter.title)}">
  <header class="chapter-head">
    <div class="chapter-top">
      <div class="chapter-ident">
        <span class="chapter-no">${chapter.num}</span>
        <span class="chapter-meta">${metaParts.join(' · ')}</span>
      </div>
      <div class="chapter-tools">
        <button type="button" class="tool-btn" data-read="${chapter.id}" aria-pressed="false">标记已读</button>
        <button type="button" class="tool-btn" data-bookmark="${chapter.id}" aria-pressed="false">书签</button>
      </div>
    </div>
    <h2 class="chapter-title">${inline(chapter.title)}</h2>
    ${chapter.lead ? `<p class="chapter-lead">${inline(chapter.lead)}</p>` : ''}
  </header>
  ${chapter.introHtml ? `<div class="prose chapter-intro">${chapter.introHtml}</div>` : ''}
  ${body}
  ${chapter.tailHtml}
</section>`;
}

function buildBook(entry) {
  const { id, dir, book } = entry;
  const rawFront = fs.readFileSync(path.join(dir, book.front), 'utf8');
  const front = parseFront(rawFront);
  const chapters = parseChapters(dir, book, front.mapRows);

  const totalQuestions = chapters.reduce((sum, chapter) => sum + chapter.count, 0);
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.words, 0);
  if (totalQuestions !== Number(book.count)) {
    warn(`${book.title}: 版权页写 ${book.count} 题，正文解析 ${totalQuestions} 题`);
  }

  const accent = (book.theme && book.theme[0] && book.theme[0].main) || '#1C1A17';
  const light = (book.theme && book.theme[0] && book.theme[0].light) || '#F2ECDF';
  const coverFile = path.join(SITE_DIR, 'assets', 'covers', `${id}.jpg`);
  const coverLargeFile = path.join(SITE_DIR, 'assets', 'covers', `${id}-large.jpg`);
  const hasCover = fs.existsSync(coverFile);
  const hasCoverLarge = fs.existsSync(coverLargeFile);
  const meta = {
    id,
    title: book.title,
    subtitle: book.subtitle,
    tagline: book.tagline || '',
    series: book.series || '深度求索技术书系',
    author: book.author || 'DeepSeek Harness',
    publisher: book.publisher || '深度求索出版社',
    year: String(book.year || ''),
    isbn: book.isbn || '',
    price: book.price || '',
    sheets: book.sheets || '',
    count: Number(book.count) || totalQuestions,
    modules: chapters.length,
    words: totalWords,
    accent,
    light,
    cover: hasCover ? `assets/covers/${id}.jpg` : null,
    coverLarge: hasCoverLarge ? `assets/covers/${id}-large.jpg` : null,
    coverThumb: hasCover ? `assets/covers/${id}-thumb.jpg` : null,
    stat: Number(book.count) > 0 ? `${Number(book.count)} 题 · ${chapters.length} 模块` : `${chapters.length} 篇`,
    pdf: book.pdf || null,
    category: book.category || 'Agent',
  };

  const extrasByQuestion = new Map();
  for (const [questionId, extras] of Object.entries(book.extras || {})) {
    const figures = [];
    for (const item of extras || []) {
      if (!Array.isArray(item) || item[0] !== 'fig' || !item[1]) continue;
      const key = String(item[1]);
      const suffix = key.includes(':') ? key.split(':').slice(1).join(':') : key;
      const source = path.join(dir, 'publish', 'figs', `fig-${key.replace(/:/g, '-')}.png`);
      if (!fs.existsSync(source)) {
        warn(`${book.title}: 缺少配图 ${key}`);
        continue;
      }
      const relative = `assets/figs/${id}-${suffix}.png`;
      const destination = path.join(SITE_DIR, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      figures.push({ key, src: relative, caption: `图 ${suffix}` });
    }
    if (figures.length) extrasByQuestion.set(questionId, figures);
  }

  let barcode = null;
  const barcodeSource = path.join(dir, 'publish', 'figs', 'barcode.png');
  if (fs.existsSync(barcodeSource)) {
    const relative = `assets/figs/${id}-barcode.png`;
    const destination = path.join(SITE_DIR, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(barcodeSource, destination);
    barcode = relative;
  }

  const frontSections = front.sections.map((section, index) => {
    const known = /内容提要/.test(section.title)
      ? 'front-abstract'
      : /序言|前言/.test(section.title)
        ? 'front-preface'
        : `front-${index + 1}`;
    return {
      id: known,
      title: section.title,
      kicker: sectionKicker(section.title),
      html: `<section class="front-section" id="${known}" data-section="${known}" data-label="${esc(
        section.title,
      )}">
  <header class="section-head">
    <p class="kicker">${sectionKicker(section.title)}</p>
    <h2>${esc(section.title)}</h2>
  </header>
  <div class="prose">${renderBlocks(parseBlocks(section.body))}</div>
</section>`,
    };
  });
  const startTarget = frontSections[0]?.id || 'toc';

  const coverHtml = `<section class="cover-page" id="cover" data-section="cover" data-label="封面">
  <div class="page-label">封面 <span>COVER</span></div>
  <div class="cover-grid">
    <div class="cover-visual" role="button" tabindex="0" data-cover-large="${meta.coverLarge || ''}" data-cover-title="${esc(meta.title)}" data-cover-sub="${esc(meta.subtitle)}" data-cover-series="${esc(meta.series)}" data-cover-author="${esc(meta.author)}" aria-label="放大封面">
      <span class="cover-spine" aria-hidden="true"></span>
      <div class="cover-fallback">
        <small>${esc(meta.series)}</small>
        <strong>${esc(meta.title)}</strong>
        <span>${esc(meta.author)}</span>
      </div>
      ${meta.cover ? `<img src="./${meta.cover}" alt="${esc(meta.title)} 封面" onerror="this.closest('.cover-visual').classList.add('img-missing')">` : ''}
    </div>
    <div class="cover-copy">
      <p class="eyebrow"><span aria-hidden="true"></span>${esc(meta.series)} · DEEPSEEK TECHNICAL LIBRARY</p>
      <h1>${esc(meta.title)}</h1>
      <p class="cover-sub">${esc(meta.subtitle)}</p>
      ${meta.tagline ? `<p class="cover-tagline">${esc(meta.tagline)}</p>` : ''}
      <dl class="meta-grid">
        <div><dt>作者</dt><dd>${esc(meta.author)}</dd></div>
        <div><dt>出版</dt><dd>${esc(meta.publisher)}</dd></div>
        <div><dt>版次</dt><dd>${esc(meta.year)} 年 · 第 1 版</dd></div>
        ${meta.isbn ? `<div><dt>ISBN</dt><dd>${esc(meta.isbn)}</dd></div>` : ''}
        ${meta.price ? `<div><dt>定价</dt><dd>￥${esc(meta.price)}</dd></div>` : ''}
        <div><dt>开本</dt><dd>210 × 297 mm</dd></div>
      </dl>
      <div class="cover-actions">
        <button type="button" class="btn-primary" data-scroll="${startTarget}">开始阅读</button>
        <button type="button" class="btn-ghost" data-scroll="toc">目录</button>
        ${meta.pdf ? `<a class="btn-ghost" href="./${meta.pdf}" target="_blank" rel="noopener">下载 PDF</a>` : ''}
      </div>
      <p class="cover-note">${meta.stat} · 约 ${formatInt(meta.words)} 字</p>
    </div>
  </div>
</section>`;

  const tocHtml = `<section class="toc-page" id="toc" data-section="toc" data-label="目录">
  <header class="toc-page-head">
    <p class="kicker">CONTENTS</p>
    <h2>目录</h2>
    <p class="toc-page-meta">${meta.stat} · 约 ${formatInt(meta.words)} 字</p>
  </header>
  <ol class="toc-page-list">
    ${chapters
      .map((chapter) => {
        const children = chapterSections(chapter);
        const sub = children.length
          ? `<ol class="toc-page-sub">${children
              .map(
                (section) => `<li><a href="#${section.id}" data-scroll="${section.id}">
          <span class="toc-page-qno">${esc(section.qno)}</span>
          <span class="toc-page-qtitle">${esc(section.title)}</span>
          <span class="toc-page-state" data-toc-state="${section.id}" aria-hidden="true"></span>
        </a></li>`,
              )
              .join('')}</ol>`
          : '';
        return `<li><a href="#${chapter.id}" data-scroll="${chapter.id}">
      <span class="toc-page-no">${chapter.num}</span>
      <span class="toc-page-main"><span class="toc-page-title">${esc(chapter.title)}</span>${
        chapter.lead ? `<span class="toc-page-lead">${inline(chapter.lead)}</span>` : ''
      }</span>
      <span class="toc-row-meta">${chapter.qRange ? `${chapter.qRange}<br>` : ''}<span>${chapter.count ? `${chapter.count} 题` : `${formatInt(chapter.words)} 字`}</span></span>
      <span class="toc-page-state" data-toc-state="${chapter.id}" aria-hidden="true"></span>
    </a>${sub}</li>`;
      })
      .join('')}
  </ol>
  <p class="toc-page-note">${esc(meta.series)} · ${esc(meta.year)}</p>
</section>`;

  const backIntro = renderBlocks(parseBlocks(front.back.introMd)) || `<p>${inline(meta.subtitle)}</p>`;
  const backAudience = renderBlocks(parseBlocks(front.back.audienceMd));
  const backMain = front.back.main || `${meta.count} 题，覆盖 ${meta.modules} 个模块`;
  const backSub = front.back.sub || meta.tagline || meta.subtitle;
  const colophon = [
    ['作者', meta.author],
    ['出版', meta.publisher],
    ['版次', `${meta.year} 年 · 第 1 版`],
    ['印张', meta.sheets ? String(meta.sheets) : ''],
    ['ISBN', meta.isbn],
    ['定价', meta.price ? `￥${meta.price}` : ''],
  ].filter(([, value]) => value);

  const backHtml = `<section class="back-cover" id="back" data-section="back" data-label="封底">
  <span class="back-ghost" aria-hidden="true">${meta.count || ''}</span>
  <div class="back-inner">
    <p class="back-series">${esc(meta.series)} · ${esc(meta.year)}</p>
    <h2 class="back-main">${inline(backMain)}</h2>
    <p class="back-sub">${inline(backSub)}</p>
    <span class="back-rule" aria-hidden="true"></span>
    <div class="back-blurb">${backIntro}</div>
    ${backAudience ? `<div class="back-audience"><p class="back-label">适合谁读</p>${backAudience}</div>` : ''}
    ${
      front.keywords.length
        ? `<div class="back-keywords">${front.keywords.map((keyword) => `<span>${inline(keyword)}</span>`).join('')}</div>`
        : ''
    }
    <div class="back-bottom">
      <dl class="colophon">${colophon
        .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
        .join('')}</dl>
      ${
        barcode
          ? `<div class="barcode-card"><img src="./${barcode}" alt="ISBN ${esc(meta.isbn)} 条码"><span>ISBN ${esc(meta.isbn)}</span></div>`
          : ''
      }
    </div>
    <button type="button" class="back-return" data-scroll="cover">回到封面</button>
  </div>
</section>`;

  const data = {
    meta: { ...meta, startTarget, barcode },
    front: frontSections,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      num: chapter.num,
      title: chapter.title,
      lead: chapter.lead,
      count: chapter.count,
      qRange: chapter.qRange,
      words: chapter.words,
      sections: chapterSections(chapter),
      html: renderChapter(chapter, extrasByQuestion),
    })),
    coverHtml,
    tocHtml,
    backHtml,
  };

  return {
    id,
    data,
    index: {
      id,
      title: meta.title,
      subtitle: meta.subtitle,
      tagline: meta.tagline,
      series: meta.series,
      author: meta.author,
      publisher: meta.publisher,
      year: meta.year,
      isbn: meta.isbn,
      price: meta.price,
      count: meta.count,
      modules: meta.modules,
      words: meta.words,
      accent: meta.accent,
      light: meta.light,
      cover: meta.cover,
      coverLarge: meta.coverLarge,
      coverThumb: meta.coverThumb,
      stat: meta.stat,
      pdf: meta.pdf,
    },
    stats: {
      title: meta.title,
      modules: chapters.length,
      questions: totalQuestions,
      declared: Number(book.count),
      words: totalWords,
      figures: [...extrasByQuestion.values()].reduce((sum, list) => sum + list.length, 0),
    },
  };
}

function loadEntries() {
  const manifestPath = path.join(BOOKS_DIR, 'manifest.json');
  let order;
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    order = manifest.order;
  } else {
    order = fs
      .readdirSync(BOOKS_DIR)
      .filter((name) => fs.statSync(path.join(BOOKS_DIR, name)).isDirectory());
  }
  return order.map((id) => {
    const dir = path.join(BOOKS_DIR, id);
    const book = JSON.parse(fs.readFileSync(path.join(dir, 'publish', 'book.json'), 'utf8'));
    return { id, dir, book };
  });
}

function main() {
  fs.mkdirSync(path.join(SITE_DIR, 'data'), { recursive: true });
  fs.mkdirSync(path.join(SITE_DIR, 'assets'), { recursive: true });
  for (const fileName of ['style.css', 'app.js', 'index.html']) {
    const source = path.join(SRC_DIR, fileName);
    if (!fs.existsSync(source)) throw new Error(`missing source file: ${source}`);
    fs.copyFileSync(source, path.join(SITE_DIR, fileName));
  }

  const entries = loadEntries();
  const shelf = [];
  const results = [];

  for (const entry of entries) {
    const result = buildBook(entry);
    shelf.push({ ...result.index, category: entry.book.category || 'Agent' });
    results.push(result);
    fs.writeFileSync(path.join(SITE_DIR, 'data', `book-${entry.id}.json`), JSON.stringify(result.data), 'utf8');
    if (result.index.cover) {
      const coverPath = path.join(SITE_DIR, result.index.cover);
      if (!fs.existsSync(coverPath)) {
        warn(`${entry.id}: 缺少网页封面 ${result.index.cover}，请先运行 tools/make-covers.py`);
      }
    }
    console.log(
      `[build] ${entry.id.padEnd(16)} modules=${String(result.stats.modules).padStart(2)} questions=${String(
        result.stats.questions,
      ).padStart(3)} words=${formatInt(result.stats.words).padStart(7)} figures=${result.stats.figures}`,
    );
  }

  const pdfManifestPath = path.join(path.dirname(BOOKS_DIR), 'pdfs.manifest.json');
  if (fs.existsSync(pdfManifestPath)) {
    const pdfManifest = JSON.parse(fs.readFileSync(pdfManifestPath, 'utf8'));
    const pdfDir = path.join(SITE_DIR, 'assets', 'pdfs');
    fs.mkdirSync(pdfDir, { recursive: true });
    for (const pdf of pdfManifest.pdfs || []) {
      if (!fs.existsSync(pdf.source)) {
        warn(`${pdf.id}: 缺少 PDF ${pdf.source}`);
        continue;
      }
      fs.copyFileSync(pdf.source, path.join(pdfDir, pdf.file));
      console.log(`[build] ${pdf.id.padEnd(28)} pdf=${pdf.file}`);
    }
  }

  fs.writeFileSync(path.join(SITE_DIR, 'data', 'books.json'), JSON.stringify({ books: shelf }, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(SITE_DIR, 'build-info.json'),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        books: results.map((result) => ({
          id: result.id,
          ...result.stats,
          cover: result.index.cover,
        })),
        warnings,
      },
      null,
      2,
    ),
    'utf8',
  );

  if (warnings.length) {
    console.log(`\n[build] ${warnings.length} warning(s):`);
    for (const message of warnings) console.log(`  - ${message}`);
  }
  console.log(`\n[build] ${shelf.length} books written to ${path.join(SITE_DIR, 'data')}`);
}

main();
