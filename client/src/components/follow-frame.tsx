import { useEffect, useRef } from 'react';
import { Crosshair, X } from 'lucide-react';
import type { Identity } from '@/collab/identity';
import { TUTOR_COLOR } from '@/collab/identity';
import { useFollowStore } from '@/collab/use-follow-store';
import { usePresenceStore } from '@/collab/use-presence-store';
import { cn } from '@/lib/utils';

/** How long the "resume" offer stands after a pan breaks a follow. */
const RESUME_WINDOW_MS = 4_000;

/**
 * What a student sees while their view belongs to the tutor.
 *
 * The whole viewport takes a hairline in the tutor's colour — the colour their
 * cursor already wears — so "this is their view, not mine" is read from the
 * edge of the eye rather than from a sentence. A tab hangs from the top of that
 * frame with their name and the way out; being part of the frame is what says
 * the two belong together.
 *
 * A follow usually ends with a reflexive pan rather than a decision, so when
 * that happens the frame lets go but the tab stays a moment longer, gone
 * neutral, offering to resume. Leaving on purpose (the ×) needs no such offer.
 */
export function FollowFrame({ identity }: { identity: Identity | null }) {
  const following = useFollowStore((s) => s.following);
  const interruptedAt = useFollowStore((s) => s.interruptedAt);
  const tutor = usePresenceStore((s) => s.peers.find((p) => p.isTutor));

  useEffect(() => {
    if (!interruptedAt) return;
    const id = window.setTimeout(
      () => useFollowStore.getState().clearInterrupted(),
      RESUME_WINDOW_MS,
    );
    return () => window.clearTimeout(id);
  }, [interruptedAt]);

  const mode =
    !identity || identity.isTutor || !tutor
      ? null
      : following
        ? 'following'
        : interruptedAt
          ? 'resume'
          : null;

  // The tab keeps the last thing it said while it fades out, instead of
  // flashing to empty on the frame it starts leaving.
  const shown = useRef<{ mode: 'following' | 'resume'; name: string } | null>(
    null,
  );
  if (mode && tutor) shown.current = { mode, name: tutor.name };
  const last = shown.current;

  const color = tutor?.color || TUTOR_COLOR;

  return (
    <div
      aria-hidden={mode ? undefined : true}
      inert={!mode}
      className="pointer-events-none absolute inset-0"
      style={{ '--follow': color } as React.CSSProperties}
    >
      <div
        className={cn(
          'absolute inset-0 shadow-[inset_0_0_0_2px_var(--follow)] transition-opacity duration-slow ease-out-quart motion-reduce:transition-none',
          mode === 'following' ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        role="status"
        className={cn(
          'absolute top-0 left-1/2 -translate-x-1/2 transition-[translate,opacity] duration-slow ease-out-expo motion-reduce:transition-none',
          mode ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0',
        )}
      >
        {last?.mode === 'resume' ? (
          <button
            type="button"
            onClick={() => useFollowStore.getState().setFollowing(true)}
            className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-b-control border border-t-0 border-border bg-surface pr-3 pl-2.5 text-xs font-medium text-fg shadow-[var(--s-toolbar)] transition-colors duration-fast hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-3.5 [&_svg]:stroke-[1.5]"
          >
            <Crosshair aria-hidden="true" style={{ color }} />
            Follow {last.name} again
          </button>
        ) : last ? (
          <div className="pointer-events-auto flex h-7 items-center gap-1 rounded-b-control bg-[var(--follow)] pr-1 pl-2.5 text-xs font-medium text-white">
            <span
              className="follow-live-dot mr-1 size-1.5"
              aria-hidden="true"
            />
            <span className="max-w-[40vw] truncate">Following {last.name}</span>
            <button
              type="button"
              aria-label="Stop following"
              title="Stop following"
              onClick={() => useFollowStore.getState().setFollowing(false)}
              className="grid size-5 place-items-center rounded-full text-white/80 transition-colors duration-fast hover:bg-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-white [&_svg]:size-3.5 [&_svg]:stroke-2"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
