import { describe, expect, it } from 'vitest';

import { buttonVariants } from './button';

describe('button icon sizing', () => {
  it('sizes only a direct icon instead of resizing nested SVG artwork', () => {
    const classes = buttonVariants({ size: 'icon-sm' });

    expect(classes).toContain(
      '[&>svg:not([class*=\'size-\']):not([data-native-size])]:size-4',
    );
    expect(classes).not.toContain('[&_svg:not([class*=\'size-\'])]:size-4');
  });
});
