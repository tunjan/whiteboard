import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import '@/canvas/tools/register';
import { InstrumentTray } from '@/components/toolbar/toolbar-instruments';
import { ShapeClusterObject } from '@/components/toolbar/toolbar-constants';
import * as Glyphs from '@/components/ui/glyphs';

/**
 * The four instruments at three sizes on four grounds.
 *
 * They are drawn at 36 x 72 and read at that size, but a silhouette that only
 * works at one scale is a silhouette that got lucky — so this shows them small
 * enough to be a glyph and large enough to see every join. The grounds are the
 * ones that break flat drawings: white, the board's own off-white, a saturated
 * ink, and the dark board.
 */
const INKS = ['#1d1d1f', '#e03131', '#4465e9', '#e16919'];

function Row({ label, style, dark }: { label: string; style: React.CSSProperties; dark?: boolean }) {
  return (
    <div className={dark ? 'dark' : ''} style={style}>
      <div style={{ fontSize: 11, opacity: 0.5, padding: '4px 8px', color: dark ? '#fff' : '#000' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, padding: '28px 16px 8px' }}>
        {[1, 1.8, 3].map((scale) => (
          <div key={scale} className="flex h-[52px] items-stretch" style={{ transform: `scale(${scale})`, transformOrigin: 'bottom left' }}>
            <InstrumentTray tools={['draw', 'highlighter', 'eraser', 'laser']}>
              <div className="relative w-12 shrink-0 self-stretch">
                <div className="absolute inset-x-0 -top-6 bottom-0 flex items-start justify-center overflow-hidden">
                  <ShapeClusterObject className="translate-y-3.5" />
                </div>
              </div>
            </InstrumentTray>
          </div>
        ))}
      </div>
    </div>
  );
}

const GLYPHS = [
  'CursorGlyph', 'HandGlyph', 'HandGrabGlyph', 'PenGlyph', 'HighlighterGlyph',
  'EraserGlyph', 'LaserGlyph', 'TextGlyph', 'GraphGlyph', 'SigmaGlyph',
  'CommentGlyph', 'StickerGlyph', 'ImageGlyph', 'VideoGlyph', 'RectGlyph',
  'EllipseGlyph', 'LineGlyph', 'ArrowGlyph', 'FrameGlyph', 'PolygonGlyph',
  'LockGlyph', 'LockOpenGlyph', 'ChevronDownGlyph', 'ChevronUpGlyph',
  'MoreGlyph', 'PlusGlyph', 'CloseGlyph',
] as const;

/** The set at the size it ships (18px) and large enough to inspect. */
function Sheet() {
  return (
    <div style={{ background: '#fff', padding: 16 }}>
      {[18, 44].map((px) => (
        <div key={px} style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', marginBottom: 20 }}>
          {GLYPHS.map((name) => {
            const G = (Glyphs as Record<string, React.ComponentType<{ style?: React.CSSProperties }>>)[
              name
            ]!;
            return (
              <div key={name} style={{ textAlign: 'center', width: px + 28 }}>
                <G style={{ width: px, height: px, strokeWidth: 1.75 }} />
                {px === 44 && <div style={{ fontSize: 8, opacity: 0.45 }}>{name.replace('Glyph', '')}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function App() {
  return (
    <div>
      <Sheet />
      <div style={{ display: 'flex', gap: 8, padding: 8 }}>
        {INKS.map((ink) => (
          <button key={ink} type="button" onClick={() => {
            document.documentElement.style.setProperty('--demo-ink', ink);
            window.dispatchEvent(new CustomEvent('demo-ink', { detail: ink }));
          }} style={{ background: ink, width: 28, height: 28, borderRadius: 999, border: 0 }} />
        ))}
      </div>
      <Row label="white" style={{ background: '#ffffff' }} />
      <Row label="board" style={{ background: '#faf9f7' }} />
      <Row label="ink" style={{ background: '#4465e9' }} />
      <Row label="dark board" style={{ background: '#1c1917' }} dark />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
