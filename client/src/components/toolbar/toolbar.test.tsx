import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './toolbar';
import { CompactMoreMenu } from './toolbar-compact-menu';
import { InsertMenu } from './toolbar-insert-menu';

describe('Toolbar', () => {
  it('renders all toolbar tools without broken image sources', () => {
    const html = renderToStaticMarkup(<Toolbar />);

    // Should render the toolbar element
    expect(html).toContain('role="toolbar"');

    // Should not contain any broken toolbar-icon image paths
    expect(html).not.toContain('/toolbar-icons/');

    // In default resting state, the toolbar shouldn't have broken img elements
    expect(html).not.toContain('<img');

    // Tools should be present by their aria-label
    expect(html).toContain('aria-label="Select"');
    expect(html).toContain('aria-label="Pan"');
    expect(html).toContain('aria-label="Text"');
    expect(html).toContain('aria-label="Function"');
    expect(html).toContain('aria-label="Equation"');
    expect(html).toContain('aria-label="Comment"');
    expect(html).toContain('aria-label="Insert"');

    // SVGs should be present for the tool glyphs and instruments
    expect(html).toContain('<svg');
  });

  it('renders InsertMenu trigger without broken image sources', () => {
    const html = renderToStaticMarkup(<InsertMenu active={false} />);
    expect(html).not.toContain('/toolbar-icons/');
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
  });

  it('renders CompactMoreMenu trigger without broken image sources', () => {
    const html = renderToStaticMarkup(
      <CompactMoreMenu activeToolId="select" onHide={() => {}} />,
    );
    expect(html).not.toContain('/toolbar-icons/');
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
  });
});
