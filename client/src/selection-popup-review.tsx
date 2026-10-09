// TEMPORARY review harness for the Firefox-styled selection popup (section 10
// of index.css). Disposable: delete with the review, like instrument-review.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import {
  BringToFront,
  ChevronRight,
  ClipboardCopy,
  Copy,
  CopyPlus,
  EyeOff,
  Group,
  ImageDown,
  Lock,
  MoreHorizontal,
  SendToBack,
  Sigma,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import { OverflowPanel } from '@/canvas/SelectionToolbar';

function Bar({ locked }: { locked?: boolean }) {
  return (
    <div role="toolbar" data-open className="fxp-panel fxp-bar">
      <button className="fxp-key">
        <Sigma />
      </button>
      <button className="fxp-key">
        <CopyPlus />
      </button>
      <span className="fxp-bar-sep" />
      <button className="fxp-key">
        <BringToFront />
      </button>
      <button className="fxp-key">
        <SendToBack />
      </button>
      <span className="fxp-bar-sep" />
      <button className="fxp-key" aria-pressed={locked || undefined}>
        {locked ? <Lock /> : <Unlock />}
      </button>
      <button className="fxp-key fxp-key--danger">
        <Trash2 />
      </button>
      <button className="fxp-key" aria-expanded={locked ? 'true' : undefined}>
        <MoreHorizontal />
      </button>
    </div>
  );
}

function Row({
  icon,
  label,
  aux,
  chevron,
  disabled,
  hi,
  danger,
}: {
  icon: ReactNode;
  label: string;
  aux?: string;
  chevron?: boolean;
  disabled?: boolean;
  hi?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={'fxp-row' + (danger ? ' fxp-row--danger' : '')}
      data-highlighted={hi || undefined}
      data-disabled={disabled || undefined}
    >
      {icon}
      {label}
      {chevron ? (
        <ChevronRight className="fxp-row-chevron" />
      ) : aux ? (
        <span className="fxp-row-aux">{aux}</span>
      ) : null}
    </div>
  );
}

const Rule = () => <div className="fxp-rule" />;

function RootMenu() {
  return (
    <div className="fxp-panel fxp-menu" data-open>
      <Row icon={<Copy />} label="Copy" aux="⌘C" />
      <Row icon={<ClipboardCopy />} label="Copy as PNG" aux="⇧⌘C" hi />
      <Row icon={<ImageDown />} label="Export PNG…" />
      <Rule />
      <Row icon={<BringToFront />} label="Bring forward" aux="⌘]" />
      <Row icon={<SendToBack />} label="Send backward" aux="⌘[" />
      <Rule />
      <Row icon={<Group />} label="Group" aux="⌘G" />
      <Row icon={<EyeOff />} label="Hide" />
    </div>
  );
}

function App() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 48,
        padding: 48,
      }}
    >
      <div style={{ display: 'grid', gap: 24 }}>
        <Bar />
        <Bar locked />
        <div className="fxp-tip" style={{ width: 'fit-content' }}>
          Bring to front<kbd className="fxp-tip-key">⇧⌘]</kbd>
        </div>
      </div>
      <RootMenu />
      <div style={{ paddingTop: 320 }}>
        <div className="fxp-panel fxp-bar" role="toolbar">
          <OverflowPanel
            below
            selectedIds={['a', 'b', 'c']}
            canAlign
            canDistribute
            canGroup
            hasGroup
            singleImageId={null}
          />
        </div>
      </div>
    </div>
  );
}

if (new URLSearchParams(location.search).has('dark'))
  document.documentElement.classList.add('dark');
document.body.style.background = 'var(--bg-canvas)';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Tooltip.Provider delay={300}>
      <App />
    </Tooltip.Provider>
  </StrictMode>,
);
