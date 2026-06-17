import type { Camera } from '@/canvas/camera';
import { worldToScreen } from '@/canvas/camera';
import { useDocumentStore } from '@/canvas/use-document-store';
import { usePresenceStore } from '@/collab/use-presence-store';

function CursorIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={{ display: 'block' }}>
      <path
        d="M5 3l14 7-6 2-2 6-6-15z"
        fill={color}
        stroke="white"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Live peer cursors, positioned from world-coordinate awareness state. */
export function CursorsLayer({ camera }: { camera: Camera }) {
  const peers = usePresenceStore((s) => s.peers);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {peers.map((p) => {
        if (!p.cursor) return null;
        // Only show cursors of peers viewing the same page.
        if (p.page && p.page !== currentPageId) return null;
        const s = worldToScreen(p.cursor, camera);
        return (
          <div
            key={p.clientId}
            className="absolute top-0 left-0"
            style={{ transform: `translate(${s.x}px, ${s.y}px)` }}
          >
            <CursorIcon color={p.color} />
            <span
              className="mt-0.5 ml-3 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm"
              style={{ background: p.color }}
            >
              {p.name}
              {p.isTutor ? ' · tutor' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
