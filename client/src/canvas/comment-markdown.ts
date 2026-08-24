/**
 * The small Markdown-with-LaTeX dialect comment bodies are written in.
 *
 * Parsing rather than rendering lives here so the grammar can be tested on its
 * own (no DOM, no MathJax) and so the renderer — `CommentText` — never has to
 * reason about delimiters again.
 *
 * The subset is deliberate. A comment is a sentence or two pinned to a spot on
 * the board, so it gets the marks people actually type in one: emphasis, code,
 * links, short lists, small headings, and math. Anything outside that (tables,
 * fenced code, images, block quotes, nested lists) stays literal text, which is
 * the only failure mode worth having — an unrecognized mark reads as what the
 * author typed instead of disappearing.
 *
 * Math is captured *before* any emphasis is looked for, so `$a_1 \times b^*$`
 * reaches MathJax exactly as written: inside math there is no such thing as an
 * underscore that means italics.
 */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'strike'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: InlineNode[] }
  /** `display` selects TeX display style (`$$…$$`, `\[…\]`) over text style. */
  | { type: 'math'; latex: string; display: boolean };

export type BlockNode =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; start: number; items: InlineNode[][] };

/** Characters a backslash may neutralize outside math. Excludes the letters
 *  LaTeX commands start with, so `\alpha` typed outside `$…$` stays visible
 *  rather than silently becoming `alpha`. */
const ESCAPABLE = new Set([
  '\\',
  '`',
  '*',
  '_',
  '~',
  '[',
  ']',
  '(',
  ')',
  '$',
  '#',
]);

/** Schemes a comment may link to. Comment text arrives from any collaborator on
 *  the board, so an author-supplied `href` is untrusted: without this, `[ok](
 *  javascript:…)` would put a script URL behind innocuous-looking text. */
const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;

/** Index of the next `close` that is not backslash-escaped, or -1. */
function findClosing(source: string, from: number, close: string): number {
  for (let i = from; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source.startsWith(close, i)) return i;
  }
  return -1;
}

/** The emphasis delimiter opening at `i`, longest first, or null. */
function emphasisAt(source: string, i: number): string | null {
  for (const delim of ['***', '**', '__', '~~', '*', '_']) {
    if (source.startsWith(delim, i)) return delim;
  }
  return null;
}

function emphasisNode(delim: string, children: InlineNode[]): InlineNode {
  if (delim === '***') {
    return { type: 'strong', children: [{ type: 'em', children }] };
  }
  if (delim === '**' || delim === '__') return { type: 'strong', children };
  if (delim === '~~') return { type: 'strike', children };
  return { type: 'em', children };
}

/**
 * Whether delimiters hug what they surround, the test that separates a mark
 * from the same character used as itself.
 *
 * "it costs $5, or $8 abroad" is the case that matters: the span between those
 * dollars ends in a space, which no one writing math types. `2 * 3 * 4` is the
 * same story for emphasis. Wrong only for someone who writes `$ x $`, whose
 * next keystroke fixes it.
 */
function tightlyDelimited(content: string): boolean {
  return content.length > 0 && !/^\s|\s$/.test(content);
}

export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let pending = '';
  let i = 0;

  const flush = () => {
    if (pending) {
      nodes.push({ type: 'text', value: pending });
      pending = '';
    }
  };
  /** Consume `[start, end)` as one node. */
  const take = (node: InlineNode, end: number) => {
    flush();
    nodes.push(node);
    i = end;
  };

  while (i < source.length) {
    const char = source[i]!;

    if (char === '\\') {
      const next = source[i + 1];
      // `\(…\)` and `\[…\]` are math delimiters before they are escapes.
      if (next === '(' || next === '[') {
        const close = next === '(' ? '\\)' : '\\]';
        const end = source.indexOf(close, i + 2);
        if (end !== -1) {
          take(
            {
              type: 'math',
              latex: source.slice(i + 2, end).trim(),
              display: next === '[',
            },
            end + 2,
          );
          continue;
        }
      }
      if (next && ESCAPABLE.has(next)) {
        pending += next;
        i += 2;
        continue;
      }
      pending += char;
      i++;
      continue;
    }

    if (char === '`') {
      // A run of n backticks closes on the next run of n, so `` a ` b `` can
      // contain one.
      const fence = /^`+/.exec(source.slice(i))![0];
      const end = source.indexOf(fence, i + fence.length);
      if (end !== -1) {
        take(
          { type: 'code', value: source.slice(i + fence.length, end).trim() },
          end + fence.length,
        );
        continue;
      }
    }

    if (char === '$') {
      const display = source.startsWith('$$', i);
      const delim = display ? '$$' : '$';
      const end = findClosing(source, i + delim.length, delim);
      const content = end === -1 ? '' : source.slice(i + delim.length, end);
      if (end !== -1 && (display || tightlyDelimited(content))) {
        take(
          { type: 'math', latex: content.trim(), display },
          end + delim.length,
        );
        continue;
      }
    }

    if (char === '[') {
      const link = /^\[([^\]]*)\]\(\s*([^()\s]*)\s*\)/.exec(source.slice(i));
      // A bracket that isn't a link (a citation marker, an interval) falls
      // through to plain text, as does one pointing somewhere unsafe.
      if (link && SAFE_LINK.test(link[2]!)) {
        take(
          { type: 'link', href: link[2]!, children: parseInline(link[1]!) },
          i + link[0].length,
        );
        continue;
      }
    }

    const delim = emphasisAt(source, i);
    // `_` inside a word is a name (`n_max`, `snake_case`), never emphasis.
    const intraword = char === '_' && i > 0 && /\w/.test(source[i - 1]!);
    if (delim && !intraword) {
      const end = findClosing(source, i + delim.length, delim);
      const content = end === -1 ? '' : source.slice(i + delim.length, end);
      if (end !== -1 && tightlyDelimited(content)) {
        take(emphasisNode(delim, parseInline(content)), end + delim.length);
        continue;
      }
    }

    pending += char;
    i++;
  }

  flush();
  return nodes;
}

/**
 * Split a comment body into blocks, then parse each block's inline content.
 *
 * Lines inside a paragraph are kept (joined with `\n`) rather than folded
 * together: comments are typed like chat messages, where a line break was meant
 * as one. The renderer keeps them.
 */
export function parseCommentMarkdown(source: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({
      type: 'paragraph',
      children: parseInline(paragraph.join('\n')),
    });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({
      type: 'list',
      ordered: list.ordered,
      start: list.start,
      items: list.items.map(parseInline),
    });
    list = null;
  };

  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        children: parseInline(heading[2]!),
      });
      continue;
    }

    const ordered = ORDERED.exec(line);
    const bullet = ordered ? null : BULLET.exec(line);
    if (ordered !== null || bullet !== null) {
      flushParagraph();
      const isOrdered = ordered !== null;
      // A switch of marker starts a new list rather than mixing the two.
      if (list && list.ordered !== isOrdered) flushList();
      list ??= {
        ordered: isOrdered,
        // `4.` numbers the first item 4, so a comment can quote one step of a
        // longer worked solution.
        start: ordered ? Number(ordered[1]) : 1,
        items: [],
      };
      list.items.push(ordered ? ordered[2]! : bullet![1]!);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}
