import { useState } from 'react';
import { ArrowLeft, Moon, Settings2, Sun } from 'lucide-react';
import type { Identity } from '@/collab/identity';
import { usePresenceStore } from '@/collab/use-presence-store';
import { ConnectionIndicator } from '@/components/connection-indicator';
import { FollowControls } from '@/components/follow-controls';
import { MusicPlayer } from '@/music/music-player';
import { PageMenu } from '@/components/page-menu';
import { SettingsDialog } from '@/components/settings-dialog';
import { ShareButton } from '@/components/share-button';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { useThemeStore } from '@/use-theme-store';
import { cn, isLightColor } from '@/lib/utils';

const MAX_VISIBLE_AVATARS = 4;

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function Avatar({ name, color }: { name: string; color: string }) {
  const isLight = isLightColor(color);
  return (
    <div
      className={cn(
        "flex size-7 items-center justify-center rounded-full border-2 border-card text-[11px] font-bold transition-all",
        isLight ? "text-zinc-950" : "text-white"
      )}
      style={{ background: color }}
      title={name}
    >
      {initial(name)}
    </div>
  );
}

function OverflowAvatar({ count }: { count: number }) {
  return (
    <div
      className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground"
      title={`${count} more present`}
    >
      +{count}
    </div>
  );
}

/**
 * Docked top chrome header for a board. A single, full-width top header docked at the top edge.
 */
export function BoardChrome({
  title,
  onBack,
  identity,
}: {
  title: string;
  onBack: () => void;
  identity: Identity | null;
}) {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const peers = usePresenceStore((s) => s.peers);
  const present = peers.length + (identity ? 1 : 0);
  const participants = [
    ...peers.map((peer) => ({
      id: `peer-${peer.clientId}`,
      name: peer.name,
      color: peer.color,
    })),
    ...(identity
      ? [{ id: 'local-user', name: identity.name, color: identity.color }]
      : []),
  ];
  const visibleParticipants = participants.slice(0, MAX_VISIBLE_AVATARS);
  const overflowCount = Math.max(
    0,
    participants.length - visibleParticipants.length,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      {/* Left Floating Panel (Back & Title) */}
      <Surface className="touch-targets absolute top-[calc(1rem+env(safe-area-inset-top))] left-[calc(1rem+env(safe-area-inset-left))] z-20 flex h-11 items-center gap-1.5 px-1.5">
        {/* Back navigates to the boards list, which is tutor-only. Students join
            via a shared link and aren't authenticated, so following it would
            bounce them to the login page — hide it for them. */}
        {identity?.isTutor && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to boards"
            onClick={onBack}
            className="size-8 rounded-lg"
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <span className="max-w-[140px] truncate text-sm font-semibold text-foreground">
          {title}
        </span>
        <div className="h-5 w-px bg-border" />
        <PageMenu />
      </Surface>

      {/* Center Floating Panel (Collab & Presence) */}
      <Surface className="absolute top-[calc(1rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-20 flex h-11 items-center gap-3 px-3.5">
        <ConnectionIndicator />
        <div className="h-5 w-px bg-border" />
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {visibleParticipants.map((participant) => (
              <Avatar
                key={participant.id}
                name={participant.name}
                color={participant.color}
              />
            ))}
            {overflowCount > 0 ? <OverflowAvatar count={overflowCount} /> : null}
          </div>
          <span className="min-w-4 text-right text-xs font-semibold tabular-nums text-foreground">
            {present}
          </span>
          <span className="text-xs text-muted-foreground hidden xs:inline">present</span>
        </div>
      </Surface>

      {/* Right Floating Panel (Music, view controls, settings, share) */}
      <Surface className="touch-targets absolute top-[calc(1rem+env(safe-area-inset-top))] right-[calc(1rem+env(safe-area-inset-right))] z-20 flex h-11 items-center gap-1.5 px-2">
        <MusicPlayer identity={identity} />
        <div className="h-5 w-px bg-border" />
        <FollowControls identity={identity} />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle theme"
          onClick={toggle}
          className="size-8 rounded-lg"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
          className="size-8 rounded-lg"
        >
          <Settings2 className="size-4" />
        </Button>
        <div className="h-5 w-px bg-border" />
        <ShareButton />
      </Surface>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
