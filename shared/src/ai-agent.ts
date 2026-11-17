import type { FillStyle, PolygonKind } from './shapes/shapes';
import type { AudioFormat } from './ai-latex';

/**
 * Contract for the board agent (`POST /api/ai/agent`): an instruction, typed or
 * spoken, plus what the board looks like → the edits to make.
 *
 * The server only ever answers with actions; the client applies them through
 * the editor in one transaction, so they sync like any local edit and undo as
 * one step.
 */

/** Longest typed instruction accepted. */
export const MAX_AGENT_INSTRUCTION_CHARS = 1000;

/** Ceiling on the serialized board summary, in characters. */
export const MAX_AGENT_BOARD_CHARS = 64 * 1024;

/** Most shapes the client describes to the model, nearest the view first. */
export const MAX_AGENT_SUMMARY_SHAPES = 150;

/** Most actions one instruction may produce. */
export const MAX_AGENT_ACTIONS = 40;

/**
 * Colours the model may name. The client maps each name to the palette slot of
 * the same name in the current theme; `black` is the ink slot, so it reads as
 * white on a dark canvas like any other ink.
 */
export const AGENT_COLORS = [
  'black',
  'grey',
  'light violet',
  'violet',
  'blue',
  'light blue',
  'yellow',
  'orange',
  'green',
  'light green',
  'light red',
  'red',
] as const;
export type AgentColor = (typeof AGENT_COLORS)[number];

export const AGENT_SHAPE_KINDS = [
  'rectangle',
  'ellipse',
  'triangle',
  'diamond',
  'parallelogram',
  'trapezoid',
  'pentagon',
  'hexagon',
  'cloud',
  'star',
] as const satisfies readonly ('rectangle' | 'ellipse' | PolygonKind)[];
export type AgentShapeKind = (typeof AGENT_SHAPE_KINDS)[number];

/** Built-in sticker ids (the client's `sticker-catalog.tsx`) the model may stamp. */
export const AGENT_STICKERS = [
  'thumbs-up',
  'thumbs-down',
  'star',
  'heart',
  'flame',
  'zap',
  'party',
  'sparkles',
  'mind-blown',
  'skull',
  'question',
  'alert',
  'check',
  'eyes',
] as const;

/**
 * New sticker artwork generated per instruction, at most. Each one is an image
 * model call and a cut-out review for the user, so a runaway answer is capped.
 */
export const MAX_AGENT_GENERATED_STICKERS = 4;

/** An arrow end: a free point, or a shape it stays attached to. */
export type AgentArrowEnd = { x: number; y: number } | { shapeId: string };

/**
 * World coordinates; `x`/`y` are a top-left corner. Omitted → stacked down the
 * middle of the view; either way the client keeps new items inside the view.
 */
export type AgentAction =
  | {
      type: 'create_text';
      text: string;
      x?: number;
      y?: number;
      fontSize?: number;
      color?: AgentColor;
    }
  | {
      type: 'create_equation';
      latex: string;
      x?: number;
      y?: number;
      fontSize?: number;
      color?: AgentColor;
    }
  | {
      type: 'create_graph';
      expressions: string[];
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      viewport?: { xMin: number; xMax: number; yMin: number; yMax: number };
    }
  | { type: 'create_sticker'; sticker: string; x?: number; y?: number; size?: number }
  /** New artwork from a description, through the same path as the toolbar's. */
  | { type: 'generate_sticker'; prompt: string; x?: number; y?: number; size?: number }
  | {
      type: 'create_shape';
      kind: AgentShapeKind;
      x?: number;
      y?: number;
      w: number;
      h: number;
      color?: AgentColor;
      fillStyle?: FillStyle;
    }
  | {
      type: 'create_arrow';
      from: AgentArrowEnd;
      to: AgentArrowEnd;
      label?: string;
      color?: AgentColor;
    }
  | {
      type: 'update_shape';
      id: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      fontSize?: number;
      color?: AgentColor;
      text?: string;
      latex?: string;
      expressions?: string[];
      fillStyle?: FillStyle;
    }
  | { type: 'delete_shapes'; ids: string[] }
  /** Around `ids` when given (they become its children), else at x/y/w/h. */
  | {
      type: 'create_frame';
      name: string;
      ids?: string[];
      x?: number;
      y?: number;
      w?: number;
      h?: number;
    }
  | { type: 'align_shapes'; ids: string[]; align: AgentAlign }
  | { type: 'group_shapes'; ids: string[] };

/** Edges and centres to line shapes up on, or even spacing along an axis. */
export const AGENT_ALIGNS = [
  'left',
  'center',
  'right',
  'top',
  'middle',
  'bottom',
  'distribute-horizontal',
  'distribute-vertical',
] as const;
export type AgentAlign = (typeof AGENT_ALIGNS)[number];

/** One shape as the model sees it: bounds, colour and readable content only. */
export interface AgentShapeSummary {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  /** Text, LaTeX, a sticker id, a frame name or an arrow label. */
  content?: string;
  /** A graph's expressions. */
  expressions?: string[];
  parentId?: string;
}

export interface AgentBoardSummary {
  /** The visible world rectangle. */
  viewport: { x: number; y: number; w: number; h: number };
  selection: string[];
  shapes: AgentShapeSummary[];
  /** Shapes on the page beyond the ones described. */
  omitted: number;
}

const NOUNS: Partial<Record<AgentAction['type'], [string, string]>> = {
  create_text: ['a text', 'texts'],
  create_equation: ['an equation', 'equations'],
  create_graph: ['a graph', 'graphs'],
  create_sticker: ['a sticker', 'stickers'],
  generate_sticker: ['a sticker', 'stickers'],
  create_shape: ['a shape', 'shapes'],
  create_arrow: ['an arrow', 'arrows'],
  create_frame: ['a frame', 'frames'],
};

const count = (n: number, [one, many]: [string, string]) => (n === 1 ? one : `${n} ${many}`);

/** What a set of actions did, in a few words: "Added an equation and 2 arrows". */
export function describeActions(actions: AgentAction[]): string {
  // Keyed by the word, so both kinds of sticker count as one.
  const added = new Map<string, [noun: [string, string], n: number]>();
  let changed = 0;
  let deleted = 0;
  for (const action of actions) {
    if (action.type === 'update_shape' || action.type === 'align_shapes' || action.type === 'group_shapes') {
      changed++;
    } else if (action.type === 'delete_shapes') deleted += action.ids.length;
    else {
      const noun = NOUNS[action.type]!;
      added.set(noun[1], [noun, (added.get(noun[1])?.[1] ?? 0) + 1]);
    }
  }
  const nouns = [...added.values()].map(([noun, n]) => count(n, noun));
  const parts = [
    nouns.length ? `added ${nouns.length > 1 ? `${nouns.slice(0, -1).join(', ')} and ${nouns.at(-1)}` : nouns[0]}` : '',
    changed ? `changed ${count(changed, ['an item', 'items'])}` : '',
    deleted ? `deleted ${count(deleted, ['an item', 'items'])}` : '',
  ].filter(Boolean);
  const text = parts.join(', ') || 'done';
  return text[0]!.toUpperCase() + text.slice(1);
}

/** Longest answer the agent may give to a question. */
export const MAX_AGENT_REPLY_CHARS = 4000;

/** How many earlier exchanges go with an instruction, so follow-ups can chain. */
export const MAX_AGENT_HISTORY = 3;

/**
 * An exchange before this one, so a follow-up ("why?", "now make it red")
 * has something to refer to. `answer` is the reply, or what the edits did.
 */
export interface AgentPrevious {
  instruction: string;
  answer: string;
}

export type AgentRequest = {
  board: AgentBoardSummary;
  who?: AgentAsker;
  /** The last few exchanges, oldest first, up to `MAX_AGENT_HISTORY`. */
  previous?: AgentPrevious[];
  /**
   * A picture of the selection, or of everything in view, as a PNG data URL:
   * the one the model asked for with `look`, or sent up front when what it
   * would be asked about is handwriting or an image the summary can't show.
   */
  image?: string;
  /** Answer as server-sent `AgentStreamEvent`s instead of one JSON body. */
  stream?: boolean;
} & ({ text: string } | { audio: string; format: AudioFormat });

/**
 * How much the board agent may do for a student, set by the tutor per board.
 * `hints` steers it away from worked answers; `off` refuses students. The
 * tutor's own instructions always get full help.
 */
export type AgentHelp = 'full' | 'hints' | 'off';
export const AGENT_HELP_MODES: readonly AgentHelp[] = ['full', 'hints', 'off'];

export interface AgentResponse {
  /** What was heard, when the instruction was spoken. */
  transcript?: string;
  /** The answer to a question, an explanation beside the edits, or why nothing was done. */
  reply?: string;
  actions: AgentAction[];
  /**
   * The model wants to see the board before it answers: ask again with the
   * same instruction (the transcript, if spoken) and a picture.
   */
  look?: boolean;
}

/**
 * What the agent is doing, sent as it happens when the request asks for a
 * stream (`stream: true`): what was heard, the model starting, and each tool
 * it starts to call (a tool name from the server's list).
 */
export type AgentProgress =
  | { step: 'heard'; transcript: string }
  | { step: 'thinking' }
  | { step: 'tool'; name: string }
  /**
   * The answer as it is written: append `text`, or replace what was shown
   * with it when `reset` (the text so far turned out not to be the answer).
   */
  | { step: 'draft'; text: string; reset?: boolean };

/** One server-sent event of a streamed agent request; the last is a result or an error. */
export type AgentStreamEvent =
  | { progress: AgentProgress }
  | { result: AgentResponse }
  | { error: string; status: number };

/**
 * The person asking, as their client published it over awareness: a label,
 * never verified. Sent so the tutor can see who asked what.
 */
export interface AgentAsker {
  name: string;
  color: string;
}

/** One student instruction to the board agent, as the tutor sees it. */
export interface AgentAsk {
  name: string;
  color: string | null;
  at: number;
  instruction: string;
  /** Edits made, a written answer, or neither. */
  kind: 'done' | 'reply' | 'nothing';
  /** `describeActions` of the edits, or the answer itself. */
  result: string;
}

/**
 * An answer's markdown and `$…$` maths as one line of plain text, for places
 * that show the gist rather than render it (a toast, the Attendance list).
 */
export function plainAnswer(text: string): string {
  return text
    .replace(/\$+([^$]*)\$+/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stateless message the server sends a tutor's board when a student asks. */
export const AGENT_ASK_PREFIX = 'whiteboard:agent-ask:';
