import { describe, expect, it } from 'vitest';
import { fits } from './models';

const model = (input: string[], output: string[]) => ({ input, output });

describe('fits', () => {
  it('needs image input for vision', () => {
    expect(fits('vision', model(['text', 'image'], ['text']))).toBe(true);
    expect(fits('vision', model(['text'], ['text']))).toBe(false);
  });

  it('needs audio in and a transcript out for dictation', () => {
    expect(fits('stt', model(['audio'], ['transcription']))).toBe(true);
    expect(fits('stt', model(['text', 'audio'], ['text']))).toBe(false);
  });

  it('needs an image out for stickers', () => {
    expect(fits('image', model(['text', 'image'], ['image']))).toBe(true);
    expect(fits('image', model(['text'], ['text']))).toBe(false);
  });

  it('takes any text-to-text model for text', () => {
    expect(fits('text', model(['text', 'image'], ['text']))).toBe(true);
    expect(fits('text', model(['audio'], ['transcription']))).toBe(false);
  });
});
