import { describe, expect, it } from 'vitest';
import { csvRow } from './usage';

describe('csvRow', () => {
  it('quotes only fields that need it, doubling inner quotes', () => {
    expect(csvRow(['a', 'b,c', 'say "hi"', 3, null])).toBe('a,"b,c","say ""hi""",3,\n');
  });
});
