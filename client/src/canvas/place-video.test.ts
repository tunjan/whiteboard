import { describe, expect, it } from 'vitest';
import { parseYoutubeId } from './place-video';

const ID = 'dQw4w9WgXcQ';

describe('parseYoutubeId', () => {
  it('parses watch URLs', () => {
    expect(parseYoutubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYoutubeId(`https://youtube.com/watch?v=${ID}&t=42s`)).toBe(ID);
    expect(parseYoutubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('parses youtu.be short links', () => {
    expect(parseYoutubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(parseYoutubeId(`https://youtu.be/${ID}?t=10`)).toBe(ID);
  });

  it('parses embed and shorts URLs', () => {
    expect(parseYoutubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(parseYoutubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseYoutubeId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(
      ID,
    );
  });

  it('accepts a bare 11-char id', () => {
    expect(parseYoutubeId(ID)).toBe(ID);
    expect(parseYoutubeId(`  ${ID}  `)).toBe(ID);
  });

  it('rejects non-YouTube and malformed input', () => {
    expect(parseYoutubeId('')).toBeNull();
    expect(parseYoutubeId('hello world')).toBeNull();
    expect(parseYoutubeId('https://vimeo.com/12345')).toBeNull();
    expect(parseYoutubeId('https://www.youtube.com/watch?v=tooshort')).toBeNull();
    expect(parseYoutubeId('https://example.com/watch?v=' + ID)).toBeNull();
  });
});
