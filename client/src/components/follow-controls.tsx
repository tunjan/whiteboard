import { Crosshair, Users } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Identity } from '@/collab/identity';
import { TUTOR_COLOR } from '@/collab/identity';
import { summonAll } from '@/collab/presence';
import { useFollowStore } from '@/collab/use-follow-store';
import { usePresenceStore } from '@/collab/use-presence-store';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface FollowControlsProps {
  identity: Identity | null;
}

export function FollowControls({ identity }: FollowControlsProps) {
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
                <span className="flex items-center gap-2 rounded-[var(--surface-control-radius,var(--radius-lg))] px-2 text-xs font-medium text-content-emphasis" />
              }
            >
              <span
                className="size-2 rounded-full"
                style={{ background: identity.color }}
                aria-hidden="true"
              />
              {followers.length} following
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {followers.map((follower) => follower.name).join(', ')}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Bring everyone to my view"
                onClick={summonAll}
              />
            }
          >
            <Users />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Bring everyone to my view
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (!tutorPeer) return null;

  const tutorColor = tutorPeer.color || TUTOR_COLOR;
  const activeStyle = {
    '--follow-color': tutorColor,
  } as CSSProperties;

  return (
    <>
      <TooltipProvider delay={300}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={following ? 'outline' : 'ghost'}
                size="sm"
                aria-label={following ? 'Stop following tutor' : 'Follow tutor'}
                aria-pressed={following}
                onClick={toggle}
                className={cn(
                  following &&
                    'border-[var(--follow-color)] bg-[color-mix(in_oklch,var(--follow-color),transparent_84%)] text-content-emphasis hover:bg-[color-mix(in_oklch,var(--follow-color),transparent_78%)]',
                )}
                style={following ? activeStyle : undefined}
              />
            }
          >
            <Crosshair data-icon="inline-start" />
            <span className="hidden sm:inline">
              {following ? 'Following' : 'Follow tutor'}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {following ? 'Stop following tutor' : 'Follow tutor'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {following ? (
        <Surface className="absolute top-[4.75rem] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 px-3 py-2">
          <span
            className="size-2 rounded-full"
            style={{ background: tutorColor }}
            aria-hidden="true"
          />
          <span className="text-xs font-medium text-content-emphasis">
            Following tutor. Move to exit.
          </span>
        </Surface>
      ) : null}
    </>
  );
}
