import { describe, expect, it } from 'vitest';
import { absolutePreviewUrls, requestOrigin } from './app-shell';

describe('requestOrigin', () => {
  it('uses the request URL when nothing is forwarded', () => {
    expect(requestOrigin('http://localhost:3001/b/abc')).toBe(
      'http://localhost:3001',
    );
  });

  it('prefers what the proxy says it served', () => {
    expect(
      requestOrigin('http://10.0.0.4:3001/', 'https', 'board.example.com'),
    ).toBe('https://board.example.com');
  });

  it('takes the original client hop from a forwarded chain', () => {
    expect(
      requestOrigin('http://10.0.0.4:3001/', 'https, http', 'a.example, b.internal'),
    ).toBe('https://a.example');
  });

  it('falls back when the forwarded values are not usable', () => {
    expect(requestOrigin('http://localhost:3001/', 'gopher', 'evil"/>x')).toBe(
      'http://localhost:3001',
    );
  });
});

describe('absolutePreviewUrls', () => {
  const html = `<meta property="og:image" content="/best-whiteboard-og.png" />
<meta name="twitter:image" content="/best-whiteboard-og.png" />
<link rel="icon" href="/best-whiteboard-favicon.png" />
<meta name="description" content="A collaborative digital whiteboard." />`;

  it('absolutizes only the preview image tags', () => {
    const out = absolutePreviewUrls(html, 'https://board.example.com');
    expect(out).toContain(
      '<meta property="og:image" content="https://board.example.com/best-whiteboard-og.png" />',
    );
    expect(out).toContain(
      '<meta name="twitter:image" content="https://board.example.com/best-whiteboard-og.png" />',
    );
    expect(out).toContain('<link rel="icon" href="/best-whiteboard-favicon.png" />');
    expect(out).toContain('content="A collaborative digital whiteboard."');
  });

  it('leaves an already-absolute image alone', () => {
    const absolute = '<meta property="og:image" content="https://cdn.example/og.png" />';
    expect(absolutePreviewUrls(absolute, 'https://board.example.com')).toBe(absolute);
  });
});
