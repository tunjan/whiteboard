/**
 * Renders a comment body: Markdown marks as elements, `$…$` as typeset math.
 *
 * The grammar lives in `comment-markdown.ts`; this file only decides what each
 * node looks like. Math reuses the board's own MathJax pipeline
 * (`equation-render`), so a formula in a comment and the same formula as an
 * equation shape are typeset by one renderer, share one cache, and are
 * sanitized by one set of rules — comment text comes from other collaborators,
 * and the SVG it produces is injected as markup.
 */
import { Fragment, type ReactNode } from 'react';
import {
  requestEquationTypeset,
  useEquationRender,
  type EquationRender,
} from '@/canvas/equation-render';
import {
  parseCommentMarkdown,
  type BlockNode,
  type InlineNode,
} from '@/canvas/comment-markdown';
import { cn } from '@/lib/utils';

/** The em `convertEquation` typesets at. Dividing by it turns MathJax's pixel
 *  geometry into `em`, so math scales with whatever text it sits in. */
const MATHJAX_BASE_PX = 16;

type TypesetRender = Extract<EquationRender, { svg: string }>;

/**
 * How much of a formula hangs below the baseline of the line it sits on.
 *
 * MathJax reports this as a `vertical-align` style, which the sanitizer strips
 * (see `equation-convert`), so it is recovered from the viewBox instead: the
 * box runs from `minY` above the baseline to `minY + height` below it. Without
 * it every parenthesis, subscript and fraction in a sentence would float,
 * resting its *bottom* on the baseline.
 */
function mathBoxStyle(render: TypesetRender): {
  width: string;
  height: string;
  verticalAlign: string;
} {
  const viewBox = /viewBox="\s*[-\d.]+\s+(-?[\d.]+)\s+[-\d.]+\s+([\d.]+)/.exec(
    render.svg,
  );
  const height = render.height / MATHJAX_BASE_PX;
  const boxTop = Number(viewBox?.[1]);
  const boxHeight = Number(viewBox?.[2]);
  const depth =
    Number.isFinite(boxTop) && boxHeight > 0
      ? ((boxTop + boxHeight) / boxHeight) * height
      : 0;
  return {
    width: `${render.width / MATHJAX_BASE_PX}em`,
    height: `${height}em`,
    verticalAlign: `${-depth}em`,
  };
}

/** The source itself, shown while a formula is being typeset and if it can't
 *  be — an unrenderable comment still has to be readable. */
function MathSource({ latex, failed }: { latex: string; failed: boolean }) {
  return (
    <code
      className={cn(
        'rounded-xs px-0.5 font-mono text-[0.9em]',
        failed ? 'bg-danger/15 text-danger' : 'text-fg-muted',
      )}
      title={failed ? 'This formula could not be rendered.' : undefined}
    >
      {latex}
    </code>
  );
}

function CommentMath({ latex, display }: { latex: string; display: boolean }) {
  // `inline` is the typesetting style, the opposite of display math.
  const entry = useEquationRender(latex, !display);
  if (!entry) requestEquationTypeset(latex, !display);

  const body =
    entry && !('error' in entry) ? (
      <span
        role="img"
        aria-label={`Equation: ${latex}`}
        // Sized by the wrapper because `convertEquation` removes the SVG's own
        // width and height; the child fills it.
        style={mathBoxStyle(entry)}
        className="inline-block [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: entry.svg }}
      />
    ) : (
      <MathSource latex={latex} failed={Boolean(entry)} />
    );

  return display ? (
    <span className="my-1 block overflow-x-auto text-center">{body}</span>
  ) : (
    body
  );
}

function renderInline(nodes: InlineNode[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.value}</Fragment>;
      case 'strong':
        return (
          <strong key={index} className="font-semibold">
            {renderInline(node.children)}
          </strong>
        );
      case 'em':
        return (
          <em key={index} className="italic">
            {renderInline(node.children)}
          </em>
        );
      case 'strike':
        return (
          <s key={index} className="line-through">
            {renderInline(node.children)}
          </s>
        );
      case 'code':
        return (
          <code
            key={index}
            className="rounded-xs bg-canvas/60 px-1 py-0.5 font-mono text-[0.9em]"
          >
            {node.value}
          </code>
        );
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            // A comment can be written by anyone on the board, so its links
            // must not reach back through `window.opener`.
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-fg-muted"
          >
            {renderInline(node.children)}
          </a>
        );
      case 'math':
        return (
          <CommentMath key={index} latex={node.latex} display={node.display} />
        );
    }
  });
}

const HEADING_CLASS = {
  1: 'text-[1.15em] font-semibold',
  2: 'text-[1.05em] font-semibold',
  3: 'font-semibold',
} as const;

function renderBlock(block: BlockNode, index: number): ReactNode {
  if (block.type === 'heading') {
    const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';
    return (
      <Tag key={index} className={HEADING_CLASS[block.level]}>
        {renderInline(block.children)}
      </Tag>
    );
  }

  if (block.type === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul';
    return (
      <Tag
        key={index}
        start={block.ordered ? block.start : undefined}
        className={cn(
          'ml-4 flex list-outside flex-col gap-0.5',
          block.ordered ? 'list-decimal' : 'list-disc',
        )}
      >
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex} className="break-words">
            {renderInline(item)}
          </li>
        ))}
      </Tag>
    );
  }

  return (
    <p key={index} className="whitespace-pre-wrap break-words">
      {renderInline(block.children)}
    </p>
  );
}

/**
 * One comment message, formatted.
 *
 * Parsing on every render is deliberate: a comment is a few hundred characters,
 * the parse is a single pass over them, and memoizing it would only add a cache
 * to keep in step with the text.
 */
export function CommentText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = parseCommentMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {blocks.map(renderBlock)}
    </div>
  );
}
