import fs from 'node:fs';
import path from 'node:path';

// 把原生 Markdown 书稿转成书房的 body.md / front.md。
// 只处理书稿结构（H1/H2 层级、要丢掉的元信息小节、首段说明），
// 封面、封底文案、关键词等成书元信息保留在 books/<id>/publish/ 里，不在这里重写。
//
// 用法：
//   node tools/import-native.mjs           写入 body.md 与 front.md
//   node tools/import-native.mjs --check   只比对，不写盘；用于确认重构前后产物一致

const ROOT = 'E:\\dsh_home\\workspaces\\common\\library';
const BOOKS_DIR = path.join(ROOT, 'books');
const SRC = 'E:\\dsh_home\\workspaces';
const CHECK = process.argv.includes('--check');

const BOOKS = [
  {
    id: 'agent-deep',
    frontSource: `${SRC}/ai/agent-deep/00_前言与目录.md`,
    frontOptions: { drops: ['目录', '配套文档'] },
    sources: [
      `${SRC}/ai/agent-deep/01_推理与编排.md`,
      `${SRC}/ai/agent-deep/02_记忆上下文与信用.md`,
      `${SRC}/ai/agent-deep/03_路由多Agent与恢复.md`,
      `${SRC}/ai/agent-deep/04_评测与安全.md`,
      `${SRC}/ai/agent-deep/05_生产与引擎.md`,
    ],
  },
  {
    id: 'coding-csharp',
    sources: [{ file: `${SRC}/coding/docs/csharp-cheatsheet.md`, stripLead: true }],
  },
  {
    id: 'coding-go',
    sources: [{ file: `${SRC}/coding/docs/go-cheatsheet.md`, stripLead: true }],
  },
  {
    id: 'coding-python3',
    sources: [{ file: `${SRC}/coding/docs/python3-cheatsheet.md`, stripLead: true }],
  },
  {
    id: 'coding-typescript',
    sources: [{ file: `${SRC}/coding/docs/typescript-cheatsheet.md`, stripLead: true }],
  },
  {
    id: 'ai-discussions-1',
    sources: [
      `${SRC}/ai/discussions/变强与独立-正文-上.md`,
      `${SRC}/ai/discussions/变强与独立-正文-下.md`,
    ],
  },
  {
    id: 'ai-discussions-2',
    sources: [`${SRC}/ai/discussions/重资产基础设施-正文.md`],
  },
  {
    id: 'ai-coding-agents-reference',
    sources: [
      `${SRC}/ai/coding-agents/reference/00_preface.md`,
      `${SRC}/ai/coding-agents/reference/01b_overview.md`,
      `${SRC}/ai/coding-agents/reference/01_frame.md`,
      `${SRC}/ai/coding-agents/reference/02_claude-code.md`,
      `${SRC}/ai/coding-agents/reference/03_dsh.md`,
      `${SRC}/ai/coding-agents/reference/04_codex.md`,
      `${SRC}/ai/coding-agents/reference/05_hermes.md`,
      `${SRC}/ai/coding-agents/reference/06_letta.md`,
      `${SRC}/ai/coding-agents/reference/07_dify.md`,
      `${SRC}/ai/coding-agents/reference/08_borrow.md`,
      `${SRC}/ai/coding-agents/reference/09_appendix.md`,
    ],
  },
  {
    id: 'management-book',
    sources: [
      {
        file: `${SRC}/management/管理认知笔记.md`,
        stripLead: true,
        drops: ['配套文档', '目录'],
      },
      `${SRC}/management/领导梯队六道关.md`,
      { file: `${SRC}/management/三个方向详解.md`, shift: true },
      `${SRC}/management/两个镜头详解.md`,
    ],
  },
  {
    id: 'dsh-deepdive',
    frontSource: `${SRC}/ai/coding-agents/dsh-deepdive/00_preface.md`,
    sources: [
      `${SRC}/ai/coding-agents/dsh-deepdive/01_boot.md`,
      `${SRC}/ai/coding-agents/dsh-deepdive/02_loop.md`,
      `${SRC}/ai/coding-agents/dsh-deepdive/03_session.md`,
      `${SRC}/ai/coding-agents/dsh-deepdive/04_context.md`,
      `${SRC}/ai/coding-agents/dsh-deepdive/05_compaction.md`,
      `${SRC}/ai/coding-agents/dsh-deepdive/06_approval.md`,
      `${SRC}/ai/coding-agents/dsh-deepdive/07_sandbox.md`,
      `${SRC}/ai/coding-agents/dsh-deepdive/08_subagent.md`,
      `${SRC}/ai/coding-agents/dsh-deepdive/09_walkthrough.md`,
      `${SRC}/ai/coding-agents/dsh-deepdive/10_appendix.md`,
    ],
  },
];

// 清掉每本书各自的源文件外壳：跳过首个 H1，按需把后续 H1 降为 H2（合订多篇时），
// 丢掉「目录」「配套文档」这类导航小节，必要时丢掉首个标题前的说明块。
function clean(text, { shift = false, drops = [], stripLead = false } = {}) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let inFence = false;
  let sawH1 = false;
  let sawHeading = false;
  let skip = false;

  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      if (level === 1) {
        if (!sawH1) {
          sawH1 = true;
          continue;
        }
        if (shift) {
          skip = false;
          sawHeading = true;
          out.push(`## ${title}`);
          continue;
        }
      }
      if (level === 2) {
        if (drops.some((drop) => title.includes(drop))) {
          skip = true;
          continue;
        }
        skip = false;
        sawHeading = true;
        if (shift) {
          out.push(`### ${title}`);
          continue;
        }
      }
      if (level === 3 && shift) {
        sawHeading = true;
        out.push(`#### ${title}`);
        continue;
      }
      sawHeading = true;
      out.push(line);
      continue;
    }

    if (!sawHeading && stripLead) continue;
    if (!skip) out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const optionsOf = (source) =>
  typeof source === 'string' ? { file: source } : { ...source };

function firstDiff(actual, expected) {
  const a = actual.split('\n');
  const b = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return {
        line: i + 1,
        actual: (a[i] ?? '<缺失>').slice(0, 120),
        expected: (b[i] ?? '<缺失>').slice(0, 120),
      };
    }
  }
  return null;
}

function compare(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ${label}: 一致 (${actual.length} 字符)`);
    return true;
  }
  const diff = firstDiff(actual, expected);
  console.log(
    `  ${label}: 不一致 (新 ${actual.length} 字符 / 旧 ${expected.length} 字符)` +
      (diff ? `，第 ${diff.line} 行\n    新: ${diff.actual}\n    旧: ${diff.expected}` : ''),
  );
  return false;
}

let mismatches = 0;

for (const book of BOOKS) {
  const publish = path.join(BOOKS_DIR, book.id, 'publish');
  if (!fs.existsSync(publish)) {
    console.log(`[skip] ${book.id}: 缺少 ${publish}`);
    mismatches += 1;
    continue;
  }
  fs.mkdirSync(publish, { recursive: true });

  const body = book.sources
    .map((source) => {
      const spec = optionsOf(source);
      return clean(fs.readFileSync(spec.file, 'utf8'), spec);
    })
    .join('\n\n');
  const bodyFile = path.join(BOOKS_DIR, book.id, 'body.md');

  console.log(`[${book.id}]`);
  if (CHECK) {
    const exists = fs.existsSync(bodyFile);
    if (!exists) {
      console.log('  body.md: 旧文件不存在');
      mismatches += 1;
    } else if (!compare('body.md', body, fs.readFileSync(bodyFile, 'utf8'))) {
      mismatches += 1;
    }
  } else {
    fs.writeFileSync(bodyFile, body, 'utf8');
    console.log(`  body.md: 写入 ${body.length} 字符`);
  }

  if (!book.frontSource) continue;

  const existingFront = fs.existsSync(path.join(publish, 'front.md'))
    ? fs.readFileSync(path.join(publish, 'front.md'), 'utf8')
    : '';
  const backAt = existingFront.indexOf('\n## 封底');
  const back = backAt >= 0 ? existingFront.slice(backAt + 1) : '';
  const front = `${clean(fs.readFileSync(book.frontSource, 'utf8'), book.frontOptions)}\n\n${back}`;
  const frontFile = path.join(publish, 'front.md');
  if (CHECK) {
    if (!compare('front.md', front, existingFront)) mismatches += 1;
  } else {
    fs.writeFileSync(frontFile, front, 'utf8');
    console.log(`  front.md: 写入 ${front.length} 字符`);
  }
}

if (CHECK) {
  console.log(mismatches === 0 ? '\n全部一致。' : `\n${mismatches} 处不一致。`);
  process.exitCode = mismatches === 0 ? 0 : 1;
}
