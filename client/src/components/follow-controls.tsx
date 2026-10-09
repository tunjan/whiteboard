import { Crosshair, Users } from 'lucide-react';
import type { Identity } from '@/collab/identity';
import { summonAll } from '@/collab/presence';
import { useFollowStore } from '@/collab/use-follow-store';
import { usePresenceStore } from '@/collab/use-presence-store';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';

interface FollowControlsProps {
  identity: Identity | null;
  showLabel?: boolean;
  toolbarItem?: boolean;
}

export function FollowControls({
  identity,
  showLabel = false,
  toolbarItem = false,
}: FollowControlsProps) {
  const peers = usePresenceStore((s) => s.peers);
  const following = useFollowStore((s) => s.following);
  const toggle = useFollowStore((s) => s.toggle);
  const tutorPeer = peers.find((peer) => peer.isTutor);
  const hasStudents = peers.some((peer) => !peer.isTutor);

  if (!identity) return null;

  if (identity.isTutor) {
    const followers = peers.filter((peer) => !peer.isTutor && peer.following);
    if (!hasStudents) return null;

    return (
      <TooltipProvider delay={300}>
        {followers.length > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  role="img"
                  aria-label={`${followers.length} following you`}
                  className="flex h-8 items-center gap-1.5 px-1.5 text-xs font-medium text-fg tabular-nums"
                />
              }
            >
              {/* Each follower in their own colour: the same disc their
                  cursor and avatar wear, so the count names who it counts. */}
              <span className="flex -space-x-1" aria-hidden="true">
                {followers.slice(0, 3).map((follower, i) => (
                  <span
                    key={follower.clientId}
                    className="follow-live-dot size-2.5 ring-2 ring-surface"
                    style={
                      {
                        color: follower.color,
                        '--dot-delay': `${i * -0.35}s`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </span>
              {followers.length}
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Following you:{' '}
              {followers.map((follower) => follower.name).join(', ')}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size={showLabel ? 'sm' : 'icon-sm'}
                data-toolbar-item={toolbarItem || undefined}
                tabIndex={toolbarItem ? -1 : undefined}
                aria-label="Bring everyone to my view"
                onClick={summonAll}
              />
            }
          >
            <Users />
            {showLabel ? <span>Bring everyone</span> : null}
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Bring everyone to my view
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (!tutorPeer) return null;

  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              pressed={following}
              onPressedChange={toggle}
              size="sm"
              data-toolbar-item={toolbarItem || undefined}
              tabIndex={toolbarItem ? -1 : undefined}
              aria-label={following ? 'Stop following tutor' : 'Follow tutor'}
              // Following is an on/off state, so it takes the same pressed
              // idiom as every other toggle in the chrome. The tutor's colour
              // stays where it identifies a person — the frame and name tab
              // of `FollowFrame` — rather than tinting a control.
              className={cn(
                'h-8 min-w-8 border border-transparent',
                showLabel ? 'px-2.5' : 'w-8 px-0',
                following && 'border-border bg-panel text-fg',
              )}
            />
          }
        >
          <Crosshair />
          {showLabel ? (
            <span>{following ? 'Following' : 'Follow tutor'}</span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {following ? 'Stop following tutor' : 'Follow tutor'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
