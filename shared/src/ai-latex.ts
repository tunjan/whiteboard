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
