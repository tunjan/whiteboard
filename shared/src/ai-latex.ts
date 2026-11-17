/**
 * Contract for the two AI LaTeX endpoints (`/api/ai/latex/*`).
 *
 * Both go through the server rather than straight to OpenRouter: the API key is
 * spendable credit, and a board is shared by capability URL — anything the
 * client held, every participant would hold.
 */

/**
 * Ceiling on the rasterized selection a client may post, counted in characters
 * of the data URL. The image travels as a string in a JSON body, so this is the
 * limit that actually bounds the request. Comfortably above what a screen's
 * worth of handwriting rasterizes to; the client caps the raster's longest side
 * (`RECOGNITION_MAX_PX`) so a pasted photograph stays under it too.
 */
export const MAX_INK_IMAGE_CHARS = 6 * 1024 * 1024;

/**
 * Ceiling on a dictated clip, in characters of its base64 body. Opus runs at
 * ~4 KB a second, so this is well over a minute of speech — far past anything
 * the 200-character description below could hold.
 */
export const MAX_AUDIO_CHARS = 1024 * 1024;

/** Containers `MediaRecorder` produces: webm in Chrome/Firefox, mp4 in Safari. */
export const AUDIO_FORMATS = ['webm', 'mp4'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export interface TranscribeRequest {
  /** Base64 audio, no `data:` prefix. */
  audio: string;
  format: AudioFormat;
}

/**
 * The transcript, and the LaTeX written from it in the same request — one trip
 * through the tunnel instead of two. `error` replaces `latex` when the
 * transcript was heard but could not be written as maths, so the student keeps
 * the text to fix by hand.
 */
export interface TranscribeResponse {
  text: string;
  latex?: string;
  error?: string;
}

/** Longest description accepted for "quadratic formula"-style generation. */
export const MAX_LATEX_PROMPT_CHARS = 200;

/**
 * Longest LaTeX accepted back from a model. A blackboard's worth of maths is a
 * few hundred characters; past this the model has stopped transcribing and
 * started narrating, and the equation panel should not be handed the result.
 */
export const MAX_LATEX_CHARS = 2000;

/**
 * What a model replies when the ink isn't maths it can read. Checked verbatim,
 * so it must contain nothing that could appear inside a real answer.
 */
export const LATEX_UNREADABLE = 'UNREADABLE';

export interface LatexFromInkRequest {
  /** PNG data URL of the rasterized strokes. */
  image: string;
}

export interface LatexFromPromptRequest {
  /** Plain-language description, e.g. "quadratic formula". */
  prompt: string;
}

export interface LatexResponse {
  /** LaTeX body — no `$` delimiters, ready to drop into `EquationProps.latex`. */
  latex: string;
}

export interface GraphFromInkResponse {
  /** Graph-parser expressions, one per row, unvalidated. */
  expressions: string[];
}

/**
 * The model slots the tutor can choose (`GET/PUT /api/ai/models`). `vision`
 * reads ink for both equations and graphs; `text` writes LaTeX from a
 * description or a dictated transcript; `agent` turns an instruction into
 * board edits and must support tool calling; `check` reads a page of working
 * and finds its mistakes.
 */
export const AI_JOBS = ['vision', 'text', 'stt', 'image', 'agent', 'check'] as const;
export type AiJob = (typeof AI_JOBS)[number];

/** Most mistakes one check reports. */
export const MAX_CHECK_ERRORS = 5;

/**
 * One mistake the work checker found (`POST /api/ai/check`). The client tags
 * each line of working in the image it posts with a number, so a mistake is
 * located by line rather than by coordinates — vision models disagree about
 * coordinate conventions, and a router's choice of model changes per request.
 */
export interface CheckError {
  /** The tagged line the mistake is on, from 1. */
  line: number;
  /** Why it is wrong, for a comment: plain text with `$…$` maths. */
  message: string;
  /** The corrected line as a LaTeX body, when there is one to write. */
  correction?: string;
}

/** Most typeset sources one check carries; the server drops the rest. */
export const MAX_CHECK_SOURCES = 30;

/**
 * Longest typeset source a check carries. Past it the shape is read from the
 * image alone: truncated LaTeX is broken LaTeX, so it is dropped, not cut.
 */
export const MAX_CHECK_SOURCE_CHARS = 500;

/**
 * The exact source of one typeset shape on a tagged line — an equation's LaTeX
 * or a text box's text — so the model needn't read it back from pixels. A line
 * mixing ink and typeset shapes carries only its typeset parts.
 */
export interface CheckSource {
  line: number;
  kind: 'latex' | 'text';
  source: string;
}

export interface CheckRequest {
  /** PNG data URL of the tagged lines. */
  image: string;
  /** Absent from older clients; the image alone is then the whole input. */
  sources?: CheckSource[];
  /**
   * Have a second model call verify each reported mistake before it is sent
   * back. Costs a second call, and its latency, only when there is a mistake.
   */
  confirm?: boolean;
}

export interface CheckResponse {
  /** Empty when the working is correct, or holds no mathematics. */
  errors: CheckError[];
}

/** One OpenRouter catalogue entry, slimmed to what the picker shows. */
export interface AiModel {
  id: string;
  name: string;
  /** OpenRouter's USD price strings, keyed as its catalogue keys them. */
  pricing: Record<string, string>;
}

export interface AiModelsResponse {
  selected: Record<AiJob, string>;
  /** Only the models whose input/output modalities fit each job. */
  options: Record<AiJob, AiModel[]>;
}
