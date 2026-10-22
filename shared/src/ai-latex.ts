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
