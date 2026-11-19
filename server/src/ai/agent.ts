import {
  AGENT_ALIGNS,
  AGENT_COLORS,
  AGENT_SHAPE_KINDS,
  AGENT_STICKERS,
  MAX_AGENT_ACTIONS,
  MAX_AGENT_GENERATED_STICKERS,
  MAX_AGENT_HISTORY,
  MAX_STICKER_PROMPT_CHARS,
  MAX_LATEX_CHARS,
  type AgentAction,
  type AgentArrowEnd,
  type AgentBoardSummary,
  type AgentColor,
  type AgentPrevious,
  type Feature,
  type FeatureSet,
  type FillStyle,
} from '@whiteboard/shared';
import type { ChatMessage, ToolCall, ToolDefinition } from './openrouter';

/**
 * The board agent's prompt, its tools, and the validator its calls go through.
 *
 * Every tool call is untrusted: the board text in the prompt is written by
 * whoever holds the link, so a call is only ever turned into one of the typed
 * actions below, with every number clamped and every string capped. The client
 * applies them as one undoable edit on the page in view, which is the whole of
 * what a bad answer can do.
 */

export const AGENT_SYSTEM_PROMPT = String.raw`You operate a collaborative maths whiteboard for a tutor and their students.
The user gives an instruction; carry it out by calling the board tools. Make all the calls the instruction needs in one answer.

Coordinates are world units: x grows right, y grows DOWN, and (x, y) is a shape's top-left corner.
The board summary lists the visible viewport and the shapes in or near it, with their ids.
- The viewport is the rectangle from (x, y) to (x + w, y + h). New content must fit entirely inside it, in empty space, laid out tidily with 40+ units between items. If there is no room, make things smaller.
- "this", "that", "it" or "the selected …" mean the selected shapes; otherwise identify shapes by type, content, colour and position.
- Only use ids that appear in the summary.
- Mathematics goes in create_equation as LaTeX with no $ delimiters, never in create_text.
- Graph expressions use graphing-calculator syntax: "y = x^2", "y = sin(x)", "x^2 + y^2 = 9", "(cos(t), sin(t))", "(2, 3)". Don't introduce free parameters. There is no list syntax: plot several points as separate "(x, y)" expressions.
- Colours are named, e.g. "red", "blue", "black".
- create_sticker stamps a built-in sticker; for a sticker or picture of anything else, use generate_sticker.
- Never delete or rewrite anything the instruction does not ask about.
- The summary has no handwriting, pictures or rendered appearance. For a question about what the board or the selection shows, or an edit that depends on handwriting or images, call look_at_board alone first; you will then get the picture. If a picture is already attached, don't ask for it.
- To answer a question, reply in text with no tool calls. To explain something while also editing the board, call say once with the explanation; other text you write beside tool calls is never shown.
If the instruction is unclear, only a greeting, or can't be done with these tools, make no calls and reply in one short, friendly sentence that offers one or two concrete things you could do with what is on the board. Don't mention "the instruction" or that you made no changes.

Writing for the user (answers and say). It shows in a narrow card that renders Markdown and LaTeX:
- No greeting, no "I can see the board", no closing question or offer of more help.
- For anything worked out, give the working first and the conclusion after it, so the conclusion is what the working showed. Don't open with a verdict.
- All mathematics goes in LaTeX: inline as $…$ with no space just inside the dollars, even a single symbol like $b$ or $\log_{ab} b$. Never write maths as plain text, Unicode superscripts (³) or bare LaTeX outside dollars.
- A chain of working goes on its own line as display maths: $$…$$, and several steps as $$\begin{aligned} … &= … \\ … &= … \end{aligned}$$ on one line of source.
- Keep it short: a sentence or two, a few lines of working, or a short list for separate points. Bold only the one thing to notice.
- Name parts of the board the way they are labelled ("part (b)(i)", "your second line").`;

/** Added for a student when the tutor chose hints only for this board. */
export const AGENT_HINTS_PROMPT = `The user is a student, and their tutor has asked for hints only. Never give the final answer or a complete worked solution to an exercise, in text or on the board: give a hint, point at the next step or the mistake, or ask a question that leads them there. Drawing graphs, diagrams, labels and anything else that doesn't solve the exercise for them is fine.`;

const colorParam = { type: 'string', enum: AGENT_COLORS };
const position = {
  x: { type: 'number', description: 'Left edge, world units' },
  y: { type: 'number', description: 'Top edge, world units' },
};

function tool(name: string, description: string, properties: object, required: string[] = []): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
  };
}

const arrowEnd = {
  description: 'A point {x, y}, or {shapeId} to attach to a shape',
  oneOf: [
    {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    },
    { type: 'object', properties: { shapeId: { type: 'string' } }, required: ['shapeId'] },
  ],
};

/** Asks the client for a picture; answered by `lookMessages`, never an action. */
export const LOOK_TOOL = 'look_at_board';

/** Words for the user beside the edits; becomes the reply, never an action. */
export const SAY_TOOL = 'say';

const MAX_GRAPH_EXPRESSIONS = 40;

export const AGENT_TOOLS: ToolDefinition[] = [
  tool(LOOK_TOOL, 'See the board as an image: the selected shapes if anything is selected, otherwise everything in the viewport. Call it alone.', {}),
  tool(SAY_TOOL, 'Tell the user something alongside the edits (an explanation, what to notice). Markdown and $…$ maths are rendered. Call it at most once.', {
    text: { type: 'string' },
  }, ['text']),
  tool('create_text', 'Add plain text (words, labels, notes).', {
    text: { type: 'string' },
    ...position,
    fontSize: { type: 'number', description: 'Default 24' },
    color: colorParam,
  }, ['text']),
  tool('create_equation', 'Add a typeset equation.', {
    latex: { type: 'string', description: 'LaTeX body without $ delimiters' },
    ...position,
    fontSize: { type: 'number', description: 'Default 32' },
    color: colorParam,
  }, ['latex']),
  tool('create_graph', 'Add a 2D graph plotting one or more expressions.', {
    expressions: { type: 'array', items: { type: 'string' }, maxItems: MAX_GRAPH_EXPRESSIONS },
    ...position,
    w: { type: 'number', description: 'Default 420' },
    h: { type: 'number', description: 'Default 280' },
    viewport: {
      type: 'object',
      description: 'Visible maths range, default -10..10 on both axes',
      properties: {
        xMin: { type: 'number' },
        xMax: { type: 'number' },
        yMin: { type: 'number' },
        yMax: { type: 'number' },
      },
      required: ['xMin', 'xMax', 'yMin', 'yMax'],
    },
  }, ['expressions']),
  tool('create_sticker', 'Stamp a sticker (praise, emphasis, reactions).', {
    sticker: { type: 'string', enum: AGENT_STICKERS },
    ...position,
    size: { type: 'number', description: 'Default 96' },
  }, ['sticker']),
  tool('generate_sticker', 'Draw new sticker artwork from a description (an animal, an object, a character…) and place it. Slower than create_sticker; only for things it lacks.', {
    prompt: { type: 'string', description: 'What the sticker shows, e.g. "a cute cat"' },
    ...position,
    size: { type: 'number', description: 'Longest side, default 96' },
  }, ['prompt']),
  tool('create_shape', 'Add a geometric shape.', {
    kind: { type: 'string', enum: AGENT_SHAPE_KINDS },
    ...position,
    w: { type: 'number' },
    h: { type: 'number' },
    color: colorParam,
    fillStyle: { type: 'string', enum: ['none', 'solid', 'hatch', 'crosshatch'] },
  }, ['kind', 'w', 'h']),
  tool('create_arrow', 'Add an arrow between two points or shapes.', {
    from: arrowEnd,
    to: arrowEnd,
    label: { type: 'string' },
    color: colorParam,
  }, ['from', 'to']),
  tool('update_shape', 'Move, resize, recolour or change the content of an existing shape. Only pass what changes.', {
    id: { type: 'string' },
    ...position,
    w: { type: 'number' },
    h: { type: 'number' },
    fontSize: { type: 'number', description: 'Text and equations' },
    color: colorParam,
    fillStyle: { type: 'string', enum: ['none', 'solid', 'hatch', 'crosshatch'], description: 'Geometric shapes' },
    text: { type: 'string', description: 'Text shapes' },
    latex: { type: 'string', description: 'Equation shapes' },
    expressions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Graph shapes: replaces all expressions',
    },
  }, ['id']),
  tool('delete_shapes', 'Delete shapes.', {
    ids: { type: 'array', items: { type: 'string' } },
  }, ['ids']),
  tool('create_frame', 'Add a named frame (a titled box, like a slide or section). Pass ids to put those shapes inside it, sized around them; otherwise give a position and size.', {
    name: { type: 'string' },
    ids: { type: 'array', items: { type: 'string' } },
    ...position,
    w: { type: 'number' },
    h: { type: 'number' },
  }, ['name']),
  tool('align_shapes', 'Line shapes up on a shared edge or centre (2+ shapes), or space them evenly (3+).', {
    ids: { type: 'array', items: { type: 'string' } },
    align: { type: 'string', enum: AGENT_ALIGNS },
  }, ['ids', 'align']),
  tool('group_shapes', 'Group shapes so they move together (2+).', {
    ids: { type: 'array', items: { type: 'string' } },
  }, ['ids']),
];

/** What else the model is told beside the board and the instruction. */
export interface AgentContext {
  /** Earlier exchanges, oldest first. */
  previous?: AgentPrevious[];
  /** The tutor asked for hints only, and a student is asking. */
  hints?: boolean;
}

export function agentMessages(
  instruction: string,
  board: AgentBoardSummary,
  { previous, hints }: AgentContext = {},
): ChatMessage[] {
  // Earlier exchanges are context inside this turn, not replayed assistant
  // turns: the model would copy a text-only "Added a graph" instead of
  // calling the tools, and the client wrote them, not the model.
  const before = previous?.length
    ? `Earlier exchanges, oldest first, for context only (the board above is as it is now):\n${previous
        .map((p) => `User: ${p.instruction}\nResult: ${p.answer}`)
        .join('\n\n')}\n\n`
    : '';
  return [
    { role: 'system', content: hints ? `${AGENT_SYSTEM_PROMPT}\n\n${AGENT_HINTS_PROMPT}` : AGENT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Board:\n${JSON.stringify(board)}\n\n${before}Instruction: ${instruction}`,
    },
  ];
}

/**
 * The second turn, after the model asked to look: its call replayed, and the
 * picture. Rebuilt here from the instruction rather than carried by the
 * client, so a client can't hand the model a conversation of its own making.
 * The picture goes in a user turn — not every provider takes an image inside
 * a tool result.
 */
export function lookMessages(
  instruction: string,
  board: AgentBoardSummary,
  image: string,
  context: AgentContext = {},
): ChatMessage[] {
  const what = board.selection.length ? 'the selected shapes' : 'the board in view';
  return [
    ...agentMessages(instruction, board, context),
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'look', type: 'function', function: { name: LOOK_TOOL, arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'look', content: `The picture of ${what} follows.` },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: image } },
        { type: 'text', text: `This is ${what}. Now carry out the instruction.` },
      ],
    },
  ];
}

/** Every tool but the look: the picture has been taken. */
/** The board feature each tool creates, for the tools that need one on. */
const TOOL_FEATURE: Partial<Record<string, Feature>> = {
  create_equation: 'equations',
  create_graph: 'graphs',
  create_sticker: 'stickers',
  generate_sticker: 'stickers',
};

/** Whether the agent may use `tool` on a board offering `features`. */
export const toolAllowed = (tool: string, features: FeatureSet): boolean => {
  const feature = TOOL_FEATURE[tool];
  return !feature || features[feature];
};

export const AGENT_TOOLS_AFTER_LOOK = AGENT_TOOLS.filter((t) => t.function.name !== LOOK_TOOL);

/** The earlier exchanges a client sent: the last few that are two capped strings. */
export function parsePrevious(value: unknown, maxInstruction: number, maxAnswer: number): AgentPrevious[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_AGENT_HISTORY).flatMap((item) => {
    const { instruction, answer } = (item ?? {}) as Record<string, unknown>;
    const i = str(instruction, maxInstruction);
    const a = str(answer, maxAnswer);
    return i && a ? [{ instruction: i, answer: a }] : [];
  });
}

/** What the model said to the user with `say`, or nothing. */
export function sayOf(calls: ToolCall[], max: number): string | undefined {
  for (const call of calls) {
    if (call.name !== SAY_TOOL) continue;
    try {
      const text = (JSON.parse(call.arguments) as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim()) return text.trim().slice(0, max);
    } catch {
      // A malformed say is dropped like any malformed call.
    }
  }
  return undefined;
}

/**
 * What a `say` call's text reads so far, from arguments still streaming in:
 * `{"text": "half a sent` → `half a sent`. Cut back past a half-sent escape
 * (or the closing `"}`) until it decodes, so each read extends the last.
 */
export function partialSayText(args: string): string {
  const open = /^\s*\{\s*"text"\s*:\s*"/.exec(args);
  if (!open) return '';
  const rest = args.slice(open[0].length);
  for (let end = rest.length; end >= Math.max(0, rest.length - 8); end--) {
    try {
      return JSON.parse(`"${rest.slice(0, end)}"`) as string;
    } catch {
      // Not a whole string yet; one character shorter.
    }
  }
  return '';
}

// Far past any lesson, near enough that nothing lands where no one will find it.
const WORLD = 1e6;

function num(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;
}

/** A non-empty string within `max`, or nothing — truncated LaTeX is broken LaTeX. */
function str(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= max ? value : undefined;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return options.includes(value as T) ? (value as T) : undefined;
}

/**
 * The graph has no list syntax, but models write Desmos-style
 * "[(1, 2), (3, 4)]" anyway; each tuple becomes its own point row.
 */
function splitPointList(item: unknown): unknown[] {
  if (typeof item !== 'string') return [item];
  const inner = item.trim().match(/^\[(.*)\]$/s)?.[1];
  if (inner === undefined) return [item];
  const points: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && (ch === ',' || ch === undefined)) {
      const point = inner.slice(start, i).trim();
      if (point) points.push(point);
      start = i + 1;
    }
  }
  return points;
}

const graphExpressions = (value: unknown) =>
  strings(Array.isArray(value) ? value.flatMap(splitPointList) : value, MAX_GRAPH_EXPRESSIONS, 200);

function strings(value: unknown, maxItems: number, maxChars: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item) => str(item, maxChars) ?? []).slice(0, maxItems);
  return items.length ? items : undefined;
}

const coord = (value: unknown) => num(value, -WORLD, WORLD);
const size = (value: unknown) => num(value, 4, 5000);
const fontSize = (value: unknown) => num(value, 8, 400);
const color = (value: unknown) => oneOf<AgentColor>(value, AGENT_COLORS);
const id = (value: unknown) => str(value, 64);

function arrowEndOf(value: unknown): AgentArrowEnd | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const end = value as Record<string, unknown>;
  const shapeId = id(end.shapeId);
  if (shapeId) return { shapeId };
  const x = coord(end.x);
  const y = coord(end.y);
  return x !== undefined && y !== undefined ? { x, y } : undefined;
}

/** Drop the keys a call left out, so an action carries only what was asked. */
function defined<T extends object>(action: T): T {
  return Object.fromEntries(
    Object.entries(action).filter(([, value]) => value !== undefined),
  ) as T;
}

function toAction(name: string, a: Record<string, unknown>): AgentAction | null {
  switch (name) {
    case 'create_text': {
      const text = str(a.text, 2000);
      return text
        ? defined({ type: name, text, x: coord(a.x), y: coord(a.y), fontSize: fontSize(a.fontSize), color: color(a.color) })
        : null;
    }
    case 'create_equation': {
      const latex = str(a.latex, MAX_LATEX_CHARS);
      return latex
        ? defined({ type: name, latex, x: coord(a.x), y: coord(a.y), fontSize: fontSize(a.fontSize), color: color(a.color) })
        : null;
    }
    case 'create_graph': {
      const expressions = graphExpressions(a.expressions);
      if (!expressions) return null;
      const v = a.viewport as Record<string, unknown> | undefined;
      const [xMin, xMax, yMin, yMax] = [v?.xMin, v?.xMax, v?.yMin, v?.yMax].map((n) =>
        num(n, -1e9, 1e9),
      );
      const viewport =
        xMin !== undefined && xMax !== undefined && yMin !== undefined && yMax !== undefined &&
        xMin < xMax && yMin < yMax
          ? { xMin, xMax, yMin, yMax }
          : undefined;
      return defined({ type: name, expressions, x: coord(a.x), y: coord(a.y), w: size(a.w), h: size(a.h), viewport });
    }
    case 'create_sticker': {
      const sticker = oneOf(a.sticker, AGENT_STICKERS);
      return sticker
        ? defined({ type: name, sticker, x: coord(a.x), y: coord(a.y), size: size(a.size) })
        : null;
    }
    case 'generate_sticker': {
      const prompt = str(a.prompt, MAX_STICKER_PROMPT_CHARS);
      return prompt
        ? defined({ type: name, prompt, x: coord(a.x), y: coord(a.y), size: size(a.size) })
        : null;
    }
    case 'create_shape': {
      const kind = oneOf(a.kind, AGENT_SHAPE_KINDS);
      const w = size(a.w);
      const h = size(a.h);
      return kind && w && h
        ? defined({
            type: name,
            kind,
            x: coord(a.x),
            y: coord(a.y),
            w,
            h,
            color: color(a.color),
            fillStyle: oneOf<FillStyle>(a.fillStyle, ['none', 'solid', 'hatch', 'crosshatch']),
          })
        : null;
    }
    case 'create_arrow': {
      const from = arrowEndOf(a.from);
      const to = arrowEndOf(a.to);
      return from && to
        ? defined({ type: name, from, to, label: str(a.label, 200), color: color(a.color) })
        : null;
    }
    case 'update_shape': {
      const shapeId = id(a.id);
      return shapeId
        ? defined({
            type: name,
            id: shapeId,
            x: coord(a.x),
            y: coord(a.y),
            w: size(a.w),
            h: size(a.h),
            fontSize: fontSize(a.fontSize),
            color: color(a.color),
            text: str(a.text, 2000),
            latex: str(a.latex, MAX_LATEX_CHARS),
            expressions: graphExpressions(a.expressions),
            fillStyle: oneOf<FillStyle>(a.fillStyle, ['none', 'solid', 'hatch', 'crosshatch']),
          })
        : null;
    }
    case 'delete_shapes': {
      const ids = strings(a.ids, 200, 64);
      return ids ? { type: name, ids } : null;
    }
    case 'create_frame': {
      const frameName = str(a.name, 200);
      return frameName
        ? defined({
            type: name,
            name: frameName,
            ids: strings(a.ids, 200, 64),
            x: coord(a.x),
            y: coord(a.y),
            w: size(a.w),
            h: size(a.h),
          })
        : null;
    }
    case 'align_shapes': {
      const ids = strings(a.ids, 200, 64);
      const align = oneOf(a.align, AGENT_ALIGNS);
      return ids && ids.length > 1 && align ? { type: name, ids, align } : null;
    }
    case 'group_shapes': {
      const ids = strings(a.ids, 200, 64);
      return ids && ids.length > 1 ? { type: name, ids } : null;
    }
    default:
      return null;
  }
}

/**
 * The model's tool calls as typed actions. A call that is malformed, unknown or
 * out of range is dropped rather than failing the rest: "draw a graph and a
 * star sticker" should still get its graph when the sticker id was invented.
 */
export function parseAgentActions(calls: ToolCall[]): AgentAction[] {
  const actions: AgentAction[] = [];
  let generated = 0;
  for (const call of calls) {
    let args: unknown;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      continue;
    }
    if (!args || typeof args !== 'object') continue;
    const action = toAction(call.name, args as Record<string, unknown>);
    if (action?.type === 'generate_sticker' && ++generated > MAX_AGENT_GENERATED_STICKERS) continue;
    if (action) actions.push(action);
    if (actions.length === MAX_AGENT_ACTIONS) break;
  }
  return actions;
}
