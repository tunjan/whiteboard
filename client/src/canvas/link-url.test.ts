import { describe, expect, it } from 'vitest';
import {
  extractHttpUrls,
  isValidHttpUrl,
  linkHostname,
  linkUrlsFromClipboard,
  safeLinkUrl,
  urlFromHtmlClipboard,
} from './link-url';

// `urlFromHtmlClipboard` needs a DOM parser; the suite runs in node.
const hasDom = typeof DOMParser !== 'undefined';

describe('isValidHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isValidHttpUrl('https://example.com')).toBe(true);
    expect(isValidHttpUrl('http://example.com/a?b=1#c')).toBe(true);
  });

  it('rejects script-bearing and non-web protocols', () => {
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isValidHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isValidHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isValidHttpUrl('mailto:a@b.com')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isValidHttpUrl('')).toBe(false);
    expect(isValidHttpUrl('example.com')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
  });
});

describe('extractHttpUrls', () => {
  it('returns a single url', () => {
    expect(extractHttpUrls('https://example.com')).toEqual([
      'https://example.com',
    ]);
  });

  it('splits on whitespace and newlines', () => {
    expect(
      extractHttpUrls('https://a.com\nhttps://b.com  https://c.com'),
    ).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
  });

  it('deduplicates repeats', () => {
    expect(extractHttpUrls('https://a.com https://a.com')).toEqual([
      'https://a.com',
    ]);
  });

  it('is all-or-nothing: prose mentioning a link is not a link paste', () => {
    expect(extractHttpUrls('see https://a.com for details')).toBeNull();
    expect(extractHttpUrls('https://a.com javascript:alert(1)')).toBeNull();
  });

  it('rejects empty and whitespace-only input', () => {
    expect(extractHttpUrls('')).toBeNull();
    expect(extractHttpUrls('   \n ')).toBeNull();
  });
});

describe('urlFromHtmlClipboard', () => {
  it.skipIf(!hasDom)('reads a wrapped single anchor', () => {
    expect(
      urlFromHtmlClipboard(
        '<div><a href="https://example.com">https://example.com</a></div>',
      ),
    ).toBe('https://example.com');
  });

  it.skipIf(!hasDom)('decodes entities in the href', () => {
    expect(
      urlFromHtmlClipboard('<a href="https://a.com/?x=1&amp;y=2">link</a>'),
    ).toBe('https://a.com/?x=1&y=2');
  });

  it.skipIf(!hasDom)('ignores richer html and unsafe hrefs', () => {
    expect(urlFromHtmlClipboard('<p>hi</p><a href="https://a.com">a</a>')).toBeNull();
    expect(urlFromHtmlClipboard('<a href="javascript:alert(1)">x</a>')).toBeNull();
    expect(urlFromHtmlClipboard('<a>no href</a>')).toBeNull();
  });

  it('returns null for empty payloads', () => {
    expect(urlFromHtmlClipboard('')).toBeNull();
  });
});

describe('linkUrlsFromClipboard', () => {
  it('prefers the plain-text flavor', () => {
    expect(
      linkUrlsFromClipboard('https://text.com', '<a href="https://html.com">x</a>'),
    ).toEqual(['https://text.com']);
  });

  it('is not a link paste when neither flavor parses', () => {
    expect(linkUrlsFromClipboard('hello', '<p>hello</p>')).toBeNull();
  });
});

describe('safeLinkUrl', () => {
  it('gates stored urls at the point of use', () => {
    expect(safeLinkUrl('https://example.com')).toBe('https://example.com');
    expect(safeLinkUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('linkHostname', () => {
  it('trims the www prefix', () => {
    expect(linkHostname('https://www.example.com/path')).toBe('example.com');
    expect(linkHostname('https://docs.example.com')).toBe('docs.example.com');
  });

  it('falls back to the raw value when unparseable', () => {
    expect(linkHostname('nonsense')).toBe('nonsense');
  });
});
