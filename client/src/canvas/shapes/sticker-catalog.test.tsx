import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StickerPreview, STICKERS } from './sticker-catalog';

describe('StickerPreview', () => {
  it('preserves its requested viewport when nested in a control', () => {
    const markup = renderToStaticMarkup(
      <StickerPreview def={STICKERS[0]!} size={24} />,
    );

    expect(markup).toContain('width="24"');
    expect(markup).toContain('height="24"');
    expect(markup).toContain('data-native-size="true"');
    expect(markup).toContain('overflow="visible"');
  });
});
