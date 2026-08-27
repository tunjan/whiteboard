import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ContextMenuShortcut } from '@/components/ui/context-menu';

/** The menu's own content classes, rendered inline so it needs no trigger. */
function Panel({ focused }: { focused: string }) {
  const rows: [string, string | null][] = [
    ['Duplicate', '⌘D'], ['Delete', '⌫'], [null as never, null],
    ['Copy', '⌘C'], ['Paste', '⌘V'], ['Copy as PNG', '⇧⌘C'], ['Export as PNG', null],
    [null as never, null],
    ['Bring to front', '⌘⇧]'], ['Bring forward', '⌘]'], ['Send backward', '⌘['], ['Send to back', '⌘⇧['],
    [null as never, null],
    ['Group', '⌘G'], ['Ungroup', '⌘⇧G'], ['Select all', '⌘A'],
  ];
  return (
    <div className="w-52 rounded-overlay border border-border bg-surface p-1 text-fg shadow-overlay">
      {rows.map(([label, sc], i) =>
        label === null ? (
          <div key={i} className="-mx-1 my-1 h-px bg-border" />
        ) : (
          <div
            key={i}
            data-slot="context-menu-item"
            className={
              'group/context-menu-item relative flex cursor-default items-center gap-2 rounded-control px-2 py-1.5 text-sm font-medium text-fg-secondary select-none ' +
              (label === focused ? 'bg-panel text-fg' : '')
            }
          >
            {label}
            {sc ? <ContextMenuShortcut>{sc}</ContextMenuShortcut> : null}
          </div>
        ),
      )}
    </div>
  );
}

function App() {
  return (
    <div style={{ display: 'flex', gap: 40, padding: 40 }}>
      <div><div className="mb-2 text-2xs text-fg-muted">resting</div><Panel focused="" /></div>
      <div><div className="mb-2 text-2xs text-fg-muted">Bring to front focused</div><Panel focused="Bring to front" /></div>
    </div>
  );
}

if (new URLSearchParams(location.search).has('dark')) document.documentElement.classList.add('dark');
document.body.style.background = 'var(--bg-canvas)';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
