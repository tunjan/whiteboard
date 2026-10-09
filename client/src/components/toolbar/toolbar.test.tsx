import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Toolbar as ToolbarRoot } from '@/components/ui/toolbar';
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
    expect(html).toContain('aria-label="Text"');
    expect(html).toContain('aria-label="Comment"');
    expect(html).toContain('aria-label="Add image"');

    // The style controls are their own plate above the bar, not a section of
    // it, so only the ones the resting tool actually takes are mounted.
    expect(html).toContain('aria-label="Style controls"');
    expect(html).toContain('aria-label="Color"');

    // SVGs should be present for the tool glyphs
    expect(html).toContain('<svg');
  });

  // Every key is the shared toolbar button, so the bar's arrow-key
  // navigation reaches it and its states come from one place.
  it('builds every key from the toolbar button', () => {
    const html = renderToStaticMarkup(<Toolbar />);
    // The bar only: the style plate and the show-toolbar pill follow it.
    const bar = html.slice(
      html.indexOf('role="toolbar"'),
      html.indexOf('aria-label="Style controls"'),
    );
    const buttons = bar.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(10);
    for (const button of buttons) {
      expect(button).toContain('data-slot="toolbar-button"');
    }
  });

  it('presses exactly one key', () => {
    const html = renderToStaticMarkup(<Toolbar />);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('names every group', () => {
    const html = renderToStaticMarkup(<Toolbar />);
    for (const group of ['Navigate', 'Draw', 'Insert', 'More']) {
      expect(html).toContain(`aria-label="${group}"`);
    }
  });

  // Nothing on this bar samples, blurs or bevels what is behind it.
  it('carries no glass', () => {
    const html = renderToStaticMarkup(<Toolbar />);
    expect(html).not.toContain('toolbar-glass');
    expect(html).not.toContain('backdrop-filter');
  });

  it('renders InsertMenu trigger without broken image sources', () => {
    const html = renderToStaticMarkup(<InsertMenu active={false} />);
    expect(html).not.toContain('/toolbar-icons/');
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
  });

  it('renders CompactMoreMenu trigger without broken image sources', () => {
    const html = renderToStaticMarkup(
      <ToolbarRoot>
        <CompactMoreMenu activeToolId="select" onHide={() => {}} />
      </ToolbarRoot>,
    );
    expect(html).not.toContain('/toolbar-icons/');
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
  });
});
