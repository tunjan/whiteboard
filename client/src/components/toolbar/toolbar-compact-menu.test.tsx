import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import '@/canvas/tools/register';
import { Toolbar } from '@/components/ui/toolbar';
import { CompactMoreMenu } from './toolbar-compact-menu';

describe('CompactMoreMenu', () => {
  it('renders trigger button without broken image sources', () => {
    const html = renderToStaticMarkup(
      <Toolbar>
        <CompactMoreMenu activeToolId="select" onHide={() => {}} />
      </Toolbar>,
    );
    expect(html).not.toContain('/toolbar-icons/');
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
    expect(html).toContain('aria-label="More tools"');
  });

  it('reflects active tool selection in trigger label and selected state', () => {
    const html = renderToStaticMarkup(
      <Toolbar>
        <CompactMoreMenu activeToolId="hand" onHide={() => {}} />
      </Toolbar>,
    );
    expect(html).toContain('More tools, Pan selected');
    expect(html).toContain('aria-pressed="true"');
  });

  it('reflects active sticker selection in trigger', () => {
    const html = renderToStaticMarkup(
      <Toolbar>
        <CompactMoreMenu activeToolId="sticker" onHide={() => {}} />
      </Toolbar>,
    );
    expect(html).toContain('aria-pressed="true"');
  });

  // Tools with a key of their own must not light More as well.
  it('leaves keyed tools to their keys in expanded mode', () => {
    const render = (toolId: string) =>
      renderToStaticMarkup(
        <Toolbar>
          <CompactMoreMenu activeToolId={toolId} onHide={() => {}} expanded />
        </Toolbar>,
      );
    expect(render('rectangle')).not.toContain('aria-pressed="true"');
    expect(render('graph')).not.toContain('aria-pressed="true"');
    expect(render('sticker')).not.toContain('aria-pressed="true"');
    expect(render('equation')).toContain('aria-pressed="true"');
  });

  it('contains absolutely no moss green colors in markup', () => {
    const html = renderToStaticMarkup(
      <Toolbar>
        <CompactMoreMenu activeToolId="select" onHide={() => {}} expanded />
      </Toolbar>,
    );
    expect(html).not.toContain('#27604A');
    expect(html).not.toContain('#E0EFE5');
    expect(html).not.toContain('bg-moss');
    expect(html).not.toContain('text-moss');
  });
});
