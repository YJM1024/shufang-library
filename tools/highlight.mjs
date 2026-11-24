// 构建期语法高亮：零依赖，把围栏代码转成带 token 类名的 HTML。
// 支持 TypeScript/JavaScript、Python、C#、Go、Bash、JSON、XML，其余语言原样转义。

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (char) => HTML_ESCAPES[char]);
}

const LANGUAGES = {
  ts: 'TypeScript',
  js: 'JavaScript',
  python: 'Python',
  csharp: 'C#',
  go: 'Go',
  bash: 'Bash',
  json: 'JSON',
  xml: 'XML',
  text: 'Code',
};

const ALIASES = new Map([
  ['ts', 'ts'],
  ['tsx', 'ts'],
  ['typescript', 'ts'],
  ['js', 'js'],
  ['jsx', 'js'],
  ['javascript', 'js'],
  ['mjs', 'js'],
  ['cjs', 'js'],
  ['python', 'python'],
  ['py', 'python'],
  ['python3', 'python'],
  ['csharp', 'csharp'],
  ['cs', 'csharp'],
  ['c#', 'csharp'],
  ['go', 'go'],
  ['golang', 'go'],
  ['bash', 'bash'],
  ['sh', 'bash'],
  ['shell', 'bash'],
  ['zsh', 'bash'],
  ['console', 'bash'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['xml', 'xml'],
  ['html', 'xml'],
  ['svg', 'xml'],
]);

function words(text) {
  return new Set(text.trim().split(/\s+/));
}

const TS_KEYWORDS = words(`
  abstract as async await break case catch class const continue declare default delete do else enum
  export extends finally for from function get if implements import in infer instanceof interface is
  keyof let module namespace new of package private protected public readonly return satisfies set
  static switch throw try type typeof var void while with yield
`);

const TS_CONSTANTS = words('true false null undefined this super');

const TS_TYPES = words(`
  any bigint boolean never number object string symbol unknown void
  Array ReadonlyArray Promise Map Set WeakMap WeakSet Record Partial Readonly Required Pick Omit
  Exclude Extract NonNullable Awaited Iterable Iterator Generator Error Date RegExp JSON Math Object
  Function Record BigInt Symbol Uint8Array ArrayBuffer
`);

const PY_KEYWORDS = words(`
  and as assert async await break class continue def del elif else except finally for from global if
  import in is lambda nonlocal not or pass raise return try while with yield match case
`);

const PY_CONSTANTS = words('True False None self cls');

const PY_BUILTINS = words(`
  print len range str int float bool list dict set tuple type isinstance issubclass open super object
  enumerate zip map filter sorted reversed sum min max abs round any all iter next getattr setattr
  hasattr repr format Exception ValueError TypeError KeyError IndexError RuntimeError
`);

const CS_KEYWORDS = words(`
  abstract as async await base break case catch checked class const continue default delegate do else
  enum event explicit extern finally fixed for foreach goto if implicit in interface internal is lock
  namespace new operator out override params private protected public readonly ref return sealed
  sizeof stackalloc static switch this throw try typeof unchecked unsafe using virtual volatile while
  yield record init get set nameof when global partial with
`);

const CS_CONSTANTS = words('true false null');

const CS_TYPES = words(`
  bool byte char decimal double float int long object sbyte short string uint ulong ushort void var
  Task ValueTask List Dictionary HashSet Queue Stack IEnumerable IList IDictionary Span Memory
  CancellationToken Exception Action Func Nullable DateTime TimeSpan Guid
`);

const GO_KEYWORDS = words(`
  break case chan const continue default defer else fallthrough for func go goto if import interface
  map package range return select struct switch type var
`);

const GO_CONSTANTS = words('true false iota nil');

const GO_TYPES = words(`
  bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint
  uint8 uint16 uint32 uint64 uintptr any comparable
`);

const BASH_KEYWORDS = words(`
  if then else elif fi for while until do done case esac in function select return export local
  readonly declare unset shift source alias set unset eval exec exit trap test read printf cd echo
`);

const SPECS = {
  ts: {
    kind: 'code',
    lineComment: '//',
    blockComment: true,
    quotes: ['"', "'", '`'],
    keywords: TS_KEYWORDS,
    constants: TS_CONSTANTS,
    types: TS_TYPES,
  },
  js: {
    kind: 'code',
    lineComment: '//',
    blockComment: true,
    quotes: ['"', "'", '`'],
    keywords: TS_KEYWORDS,
    constants: TS_CONSTANTS,
    types: TS_TYPES,
  },
  python: {
    kind: 'code',
    lineComment: '#',
    blockComment: true,
    quotes: ['"', "'"],
    tripleQuotes: true,
    keywords: PY_KEYWORDS,
    constants: PY_CONSTANTS,
    types: PY_BUILTINS,
    decorators: true,
  },
  csharp: {
    kind: 'code',
    lineComment: '//',
    blockComment: true,
    quotes: ['"', "'"],
    verbatimStrings: true,
    keywords: CS_KEYWORDS,
    constants: CS_CONSTANTS,
    types: CS_TYPES,
  },
  go: {
    kind: 'code',
    lineComment: '//',
    blockComment: true,
    quotes: ['"', "'", '`'],
    keywords: GO_KEYWORDS,
    constants: GO_CONSTANTS,
    types: GO_TYPES,
  },
  bash: {
    kind: 'code',
    lineComment: '#',
    blockComment: false,
    quotes: ['"', "'"],
    keywords: BASH_KEYWORDS,
    constants: new Set(),
    types: new Set(),
    uppercaseTypes: false,
    variables: true,
  },
  json: { kind: 'json' },
  xml: { kind: 'xml' },
  text: { kind: 'plain' },
};

export function normalizeLanguage(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return ALIASES.get(value) || 'text';
}

export function languageLabel(lang) {
  return LANGUAGES[lang] || LANGUAGES.text;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const NUMBER_RE = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)(?:[nNlLuUfFdDmM]+)?/;

function readString(text, start, quote, options = {}) {
  const { tripleQuotes = false, verbatim = false } = options;
  let i = start;

  if (tripleQuotes && text.startsWith(quote.repeat(3), i)) {
    const close = quote.repeat(3);
    let end = text.indexOf(close, i + 3);
    end = end === -1 ? text.length : end + 3;
    return { end, html: `<span class="tok-str">${escapeHtml(text.slice(i, end))}</span>` };
  }

  i += 1;
  while (i < text.length) {
    const char = text[i];
    if (verbatim) {
      if (char === quote && text[i + 1] === quote) {
        i += 2;
        continue;
      }
      if (char === quote) {
        i += 1;
        break;
      }
      i += 1;
      continue;
    }
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === quote) {
      i += 1;
      break;
    }
    if (char === '\n') break;
    i += 1;
  }
  return { end: i, html: `<span class="tok-str">${escapeHtml(text.slice(start, i))}</span>` };
}

function tokenizeCode(text, spec) {
  const out = [];
  let i = 0;
  let lineStart = true;

  const push = (html, isNewLine = false) => {
    out.push(html);
    if (isNewLine) lineStart = true;
  };

  while (i < text.length) {
    const char = text[i];

    if (char === '\n') {
      out.push('\n');
      lineStart = true;
      i += 1;
      continue;
    }

    if (char === ' ' || char === '\t') {
      let end = i;
      while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end += 1;
      out.push(text.slice(i, end));
      i = end;
      continue;
    }

    if (spec.variables && char === '$') {
      let end = i + 1;
      if (text[end] === '{') {
        const close = text.indexOf('}', end);
        end = close === -1 ? text.length : close + 1;
      } else {
        while (end < text.length && /[A-Za-z0-9_@*#?$!-]/.test(text[end])) end += 1;
      }
      out.push(`<span class="tok-var">${escapeHtml(text.slice(i, end))}</span>`);
      i = end;
      lineStart = false;
      continue;
    }

    if (spec.blockComment && text.startsWith('/*', i)) {
      let end = text.indexOf('*/', i + 2);
      end = end === -1 ? text.length : end + 2;
      out.push(`<span class="tok-com">${escapeHtml(text.slice(i, end))}</span>`);
      i = end;
      continue;
    }

    if (spec.lineComment && text.startsWith(spec.lineComment, i)) {
      // TypeScript 的 http:// 之类不会出现在代码里；行注释到行尾
      let end = text.indexOf('\n', i);
      if (end === -1) end = text.length;
      out.push(`<span class="tok-com">${escapeHtml(text.slice(i, end))}</span>`);
      i = end;
      continue;
    }

    if (spec.decorators && char === '@' && IDENT_START.test(text[i + 1] || '')) {
      let end = i + 1;
      while (end < text.length && (IDENT_PART.test(text[end]) || text[end] === '.')) end += 1;
      out.push(`<span class="tok-fn">${escapeHtml(text.slice(i, end))}</span>`);
      i = end;
      lineStart = false;
      continue;
    }

    const quoteOptions = { tripleQuotes: spec.tripleQuotes, verbatim: false };
    let stringStart = -1;
    if (spec.quotes && spec.quotes.includes(char)) {
      stringStart = i;
    } else if (spec.verbatimStrings && (char === '@' || char === '$') && text[i + 1] === '"') {
      stringStart = i;
      quoteOptions.verbatim = char === '@';
    } else if (spec.tripleQuotes && /[rbfuRBFU]/.test(char) && spec.quotes.includes(text[i + 1] || '')) {
      stringStart = i;
      quoteOptions.prefix = true;
    }

    if (stringStart !== -1) {
      let offset = stringStart;
      if (text[offset] === '@' || text[offset] === '$') offset += 1;
      else if (quoteOptions.prefix) offset += 1;
      const quote = text[offset];
      const result = readString(text, offset, quote, {
        tripleQuotes: quoteOptions.tripleQuotes,
        verbatim: quoteOptions.verbatim,
      });
      const prefix = text.slice(stringStart, offset);
      const inner = prefix ? `<span class="tok-str">${escapeHtml(prefix)}</span>${result.html}` : result.html;
      out.push(inner);
      i = result.end;
      lineStart = false;
      continue;
    }

    if (/[0-9]/.test(char) && !IDENT_PART.test(text[i - 1] || '')) {
      const match = text.slice(i).match(NUMBER_RE);
      if (match) {
        out.push(`<span class="tok-num">${escapeHtml(match[0])}</span>`);
        i += match[0].length;
        lineStart = false;
        continue;
      }
    }

    if (IDENT_START.test(char)) {
      let end = i + 1;
      while (end < text.length && IDENT_PART.test(text[end])) end += 1;
      const word = text.slice(i, end);
      let nextIndex = end;
      while (nextIndex < text.length && /[ \t]/.test(text[nextIndex])) nextIndex += 1;
      const isCall = text[nextIndex] === '(';

      let cls = '';
      if (spec.keywords.has(word)) cls = 'tok-kw';
      else if (spec.constants.has(word)) cls = 'tok-kw';
      else if (spec.types.has(word)) cls = 'tok-type';
      else if (isCall) cls = 'tok-fn';
      else if (spec.uppercaseTypes !== false && /^[A-Z]/.test(word)) cls = 'tok-type';
      else if (spec.variables && lineStart) cls = 'tok-fn';

      out.push(cls ? `<span class="${cls}">${escapeHtml(word)}</span>` : escapeHtml(word));
      i = end;
      lineStart = false;
      continue;
    }

    out.push(escapeHtml(char));
    i += 1;
    if (char !== ' ' && char !== '\t') lineStart = false;
  }

  return out.join('');
}

function tokenizeJson(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      const result = readString(text, i, '"');
      const rest = text.slice(result.end);
      const isKey = /^\s*:/.test(rest);
      out += isKey ? result.html.replace('class="tok-str"', 'class="tok-attr"') : result.html;
      i = result.end;
      continue;
    }
    if (/\b(?:true|false|null)\b/.test(text.slice(i, i + 5))) {
      const match = text.slice(i).match(/^(?:true|false|null)\b/);
      if (match) {
        out += `<span class="tok-kw">${match[0]}</span>`;
        i += match[0].length;
        continue;
      }
    }
    if (/[0-9-]/.test(char)) {
      const match = text.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (match) {
        out += `<span class="tok-num">${match[0]}</span>`;
        i += match[0].length;
        continue;
      }
    }
    out += escapeHtml(char);
    i += 1;
  }
  return out;
}

function highlightTag(tag) {
  const parts = tag.match(/^(<\/?)([\w:.-]*)([\s\S]*?)(\/?>)$/);
  if (!parts) return `<span class="tok-com">${escapeHtml(tag)}</span>`;
  const [, open, name, body, close] = parts;

  let bodyHtml = '';
  let last = 0;
  const attrPattern = /([A-Za-z_:][\w:.-]*)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s"'>]+)?/g;
  let match;
  while ((match = attrPattern.exec(body)) !== null) {
    bodyHtml += escapeHtml(body.slice(last, match.index));
    bodyHtml += `<span class="tok-attr">${escapeHtml(match[1])}</span>`;
    if (match[2]) bodyHtml += escapeHtml(match[2]);
    if (match[3]) bodyHtml += `<span class="tok-str">${escapeHtml(match[3])}</span>`;
    last = match.index + match[0].length;
  }
  bodyHtml += escapeHtml(body.slice(last));

  return `${escapeHtml(open)}<span class="tok-type">${escapeHtml(name)}</span>${bodyHtml}${escapeHtml(close)}`;
}

function tokenizeXml(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      let end = text.indexOf('-->', i + 4);
      end = end === -1 ? text.length : end + 3;
      out += `<span class="tok-com">${escapeHtml(text.slice(i, end))}</span>`;
      i = end;
      continue;
    }
    if (text[i] === '<') {
      let end = text.indexOf('>', i);
      end = end === -1 ? text.length : end + 1;
      out += highlightTag(text.slice(i, end));
      i = end;
      continue;
    }
    const next = text.indexOf('<', i);
    const end = next === -1 ? text.length : next;
    out += escapeHtml(text.slice(i, end));
    i = end;
  }
  return out;
}

export function highlight(code, language) {
  const lang = normalizeLanguage(language);
  const spec = SPECS[lang] || SPECS.text;
  const text = String(code ?? '');
  if (!text) return '';
  if (spec.kind === 'json') return tokenizeJson(text);
  if (spec.kind === 'xml') return tokenizeXml(text);
  if (spec.kind === 'plain') return escapeHtml(text);
  return tokenizeCode(text, spec);
}
