import { Crosshair, Users } from 'lucide-react';
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
                <span className="flex items-center gap-2 rounded-md px-2 text-xs font-medium text-fg" />
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

  const tutorColor = tutorPeer.color || TUTOR_COLOR;

  return (
    <>
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
                // stays where it identifies a person — the dot in the banner
                // below — rather than tinting a control.
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

      {following ? (
        <Surface className="absolute top-[4.75rem] left-1/2 flex -translate-x-1/2 items-center gap-2 px-3 py-2">
          <span
            className="size-2 rounded-full"
            style={{ background: tutorColor }}
            aria-hidden="true"
          />
          <span className="text-xs font-medium text-fg">
            Following tutor. Move to exit.
          </span>
        </Surface>
      ) : null}
    </>
  );
}
