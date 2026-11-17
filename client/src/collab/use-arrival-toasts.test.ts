import { describe, expect, it } from 'vitest';
import { shortFileName } from '@/lib/utils';
import { joinedTitle } from './use-arrival-toasts';

describe('joinedTitle', () => {
  it('names two people and counts the rest', () => {
    expect(joinedTitle(['Ana'])).toBe('Ana joined');
    expect(joinedTitle(['Ana', 'Leo'])).toBe('Ana and Leo joined');
    expect(joinedTitle(['Ana', 'Leo', 'Sam'])).toBe('Ana, Leo and 1 other joined');
    expect(joinedTitle(['Ana', 'Leo', 'Sam', 'Mia'])).toBe(
      'Ana, Leo and 2 others joined',
    );
  });
});

describe('shortFileName', () => {
  it('keeps the end of a long name', () => {
    const short = shortFileName(
      'Quadratic equations worksheet with worked solutions final v3.pdf',
    );
    expect(short).toHaveLength(32);
    expect(short).toMatch(/^Quadratic.*…l v3\.pdf$/);
  });

  it('copes with no extension, and leaves short names alone', () => {
    expect(shortFileName('a'.repeat(60))).toHaveLength(32);
    expect(shortFileName('notes.pdf')).toBe('notes.pdf');
  });
});
