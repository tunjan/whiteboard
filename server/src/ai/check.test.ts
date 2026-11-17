import { describe, expect, it } from 'vitest';
import { MAX_CHECK_SOURCE_CHARS, MAX_CHECK_SOURCES } from '@whiteboard/shared';
import {
  checkInstruction,
  parseCheckReply,
  parseCheckSources,
  parseConfirmReply,
} from './check';

describe('parseCheckReply', () => {
  it('reads a plain reply', () => {
    expect(
      parseCheckReply('{"errors":[{"line":2,"message":"$3^2$ is $9$.","correction":"x = 9"}]}'),
    ).toEqual([{ line: 2, message: '$3^2$ is $9$.', correction: 'x = 9' }]);
  });

  it('reads through fences and preamble', () => {
    const reply = 'Here you go:\n```json\n{"errors":[{"line":1,"message":"Sign."}]}\n```';
    expect(parseCheckReply(reply)).toEqual([{ line: 1, message: 'Sign.' }]);
  });

  it('treats an empty list as correct and junk as a fault', () => {
    expect(parseCheckReply('{"errors": []}')).toEqual([]);
    expect(parseCheckReply('Looks fine to me')).toBeNull();
    expect(parseCheckReply('{"errors": "none"}')).toBeNull();
  });

  it('drops entries without a usable line or message', () => {
    expect(
      parseCheckReply(
        JSON.stringify({
          errors: [
            { line: 0, message: 'zero' },
            { line: 1.5, message: 'fraction' },
            { line: '3', message: 'string' },
            { line: 4, message: '  ' },
            'nonsense',
            { line: 5, message: 'kept' },
          ],
        }),
      ),
    ).toEqual([{ line: 5, message: 'kept' }]);
  });

  it('unwraps $ delimiters, drops an overlong correction, and caps the count', () => {
    expect(parseCheckReply('{"errors":[{"line":1,"message":"m","correction":"$x = 2$"}]}')).toEqual([
      { line: 1, message: 'm', correction: 'x = 2' },
    ]);
    const errors = Array.from({ length: 8 }, (_, i) => ({
      line: i + 1,
      message: 'm',
      correction: 'x'.repeat(5000),
    }));
    const parsed = parseCheckReply(JSON.stringify({ errors }));
    expect(parsed).toHaveLength(5);
    expect(parsed![0]).toEqual({ line: 1, message: 'm' });
  });
});

describe('parseCheckSources', () => {
  it('keeps well-formed entries and drops the rest', () => {
    expect(
      parseCheckSources([
        { line: 2, kind: 'latex', source: ' x^2\n+ 1 ' },
        { line: 0, kind: 'latex', source: 'zero' },
        { line: 501, kind: 'text', source: 'past the last tag' },
        { line: 3, kind: 'html', source: 'kind' },
        { line: 3, kind: 'text', source: 42 },
        { line: 3, kind: 'text', source: '   ' },
        { line: 3, kind: 'text', source: 'x'.repeat(MAX_CHECK_SOURCE_CHARS + 1) },
        'nonsense',
        { line: 4, kind: 'text', source: 'so x is 3' },
      ]),
    ).toEqual([
      { line: 2, kind: 'latex', source: 'x^2 + 1' },
      { line: 4, kind: 'text', source: 'so x is 3' },
    ]);
  });

  it('treats a missing or malformed field as none, and caps the count', () => {
    expect(parseCheckSources(undefined)).toEqual([]);
    expect(parseCheckSources('x = 1')).toEqual([]);
    const many = Array.from({ length: 100 }, () => ({ line: 1, kind: 'latex', source: 'x' }));
    expect(parseCheckSources(many)).toHaveLength(MAX_CHECK_SOURCES);
  });

  it('writes the sources into the instruction, saying they may be partial', () => {
    expect(checkInstruction([])).toBe('Check this working for mistakes.');
    const text = checkInstruction([{ line: 2, kind: 'latex', source: 'x^2' }]);
    expect(text).toContain('Line 2 (LaTeX): x^2');
    expect(text).toContain('the image shows all of it');
  });
});

describe('parseConfirmReply', () => {
  it('reads the upheld claim numbers', () => {
    expect(parseConfirmReply('```json\n{"confirmed": [2, 2, 9, 0, "1", 1]}\n```', 3)).toEqual([
      2, 1,
    ]);
    expect(parseConfirmReply('{"confirmed": []}', 3)).toEqual([]);
  });

  it('is null for a reply with no usable answer', () => {
    expect(parseConfirmReply('All of them are right', 2)).toBeNull();
    expect(parseConfirmReply('{"confirmed": "all"}', 2)).toBeNull();
  });
});
