import { describe, expect, it } from 'vitest';
import { parseLinkMeta } from './meta';

const PAGE = 'https://example.com/articles/one';

describe('parseLinkMeta', () => {
  it('prefers OpenGraph tags', () => {
    const meta = parseLinkMeta(
      `<html><head>
        <title>Document title</title>
        <meta property="og:title" content="OG title">
        <meta property="og:description" content="OG description">
        <meta name="description" content="Plain description">
      </head><body></body></html>`,
      PAGE,
    );
    expect(meta.title).toBe('OG title');
    expect(meta.description).toBe('OG description');
  });

  it('falls back to twitter tags, then the document title', () => {
    expect(
      parseLinkMeta(
        '<head><title>Doc</title><meta name="twitter:title" content="Tweet"></head>',
        PAGE,
      ).title,
    ).toBe('Tweet');
    expect(parseLinkMeta('<head><title>Doc</title></head>', PAGE).title).toBe(
      'Doc',
    );
  });

  it('resolves relative image and icon paths against the page url', () => {
    const meta = parseLinkMeta(
      `<head>
        <meta property="og:image" content="/media/card.png">
        <link rel="apple-touch-icon" href="../icon.png">
      </head>`,
      PAGE,
    );
    expect(meta.image).toBe('https://example.com/media/card.png');
    expect(meta.favicon).toBe('https://example.com/icon.png');
  });

  it('keeps absolute asset urls as they are', () => {
    expect(
      parseLinkMeta(
        '<head><meta property="og:image" content="https://cdn.other.com/a.jpg"></head>',
        PAGE,
      ).image,
    ).toBe('https://cdn.other.com/a.jpg');
  });

  it('drops assets with a non-web protocol', () => {
    expect(
      parseLinkMeta(
        '<head><meta property="og:image" content="javascript:alert(1)"></head>',
        PAGE,
      ).image,
    ).toBeUndefined();
  });

  it('decodes entities and collapses whitespace', () => {
    const meta = parseLinkMeta(
      `<head>
        <title>Ben &amp; Jerry&#39;s</title>
        <meta name="description" content="line one
          line two">
      </head>`,
      PAGE,
    );
    expect(meta.title).toBe("Ben & Jerry's");
    expect(meta.description).toBe('line one line two');
  });

  it('reads single-quoted and unquoted attributes', () => {
    const meta = parseLinkMeta(
      `<head><meta property='og:title' content='Quoted'>
       <link rel=icon href=/favicon.png></head>`,
      PAGE,
    );
    expect(meta.title).toBe('Quoted');
    expect(meta.favicon).toBe('https://example.com/favicon.png');
  });

  it('ignores meta tags below the head', () => {
    const meta = parseLinkMeta(
      `<head><meta property="og:title" content="Real"></head>
       <body><meta property="og:title" content="Injected"></body>`,
      PAGE,
    );
    expect(meta.title).toBe('Real');
  });

  it('returns nothing for a document without metadata', () => {
    expect(parseLinkMeta('<html><body>hi</body></html>', PAGE)).toEqual({
      title: undefined,
      description: undefined,
      image: undefined,
      favicon: undefined,
    });
  });

  it('caps very long values', () => {
    const meta = parseLinkMeta(
      `<head><meta property="og:description" content="${'x'.repeat(2000)}"></head>`,
      PAGE,
    );
    expect(meta.description).toHaveLength(400);
  });
});
