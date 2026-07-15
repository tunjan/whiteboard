import { useState } from 'react';
import {
  ArrowLeft,
  Cog,
  Download,
  EllipsisVertical,
  Moon,
  NotebookPen,
  Sun,
} from 'lucide-react';
import { exportBoardToPng } from '@/canvas/export-png';
import { DoodleAvatar } from '@/collab/avatar';
import type { Identity } from '@/collab/identity';
import { jumpToPeerViewport } from '@/collab/presence';
import {
  type PeerPresence,
  usePresenceStore,
} from '@/collab/use-presence-store';
import { BoardNotesDialog } from '@/components/board-notes-dialog';
import { AnimationControls } from '@/components/animation-controls';
import { ConnectionIndicator } from '@/components/connection-indicator';
import { FollowControls } from '@/components/follow-controls';
import { MusicPlayer } from '@/music/music-player';
import { PageMenu } from '@/components/page-menu';
import { SettingsDialog } from '@/components/settings-dialog';
import { ShareButton } from '@/components/share-button';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useThemeStore } from '@/use-theme-store';

const MAX_VISIBLE_AVATARS = 4;

interface Participant {
  id: string;
  name: string;
  avatar: string;
  isLocal: boolean;
  peer: PeerPresence | null;
}

function peerLatencyLabel(peer: PeerPresence): string {
  return peer.latencyMs === null ? 'Measuring…' : `${peer.latencyMs} ms`;
}

function Avatar({ avatar }: { avatar: string }) {
  return (
    <DoodleAvatar
      seed={avatar}
      className="size-7 shrink-0 overflow-hidden rounded-full border-2 border-bg-default"
    />
  );
}

function OverflowAvatar({
  participants,
  showPeerLatency,
}: {
  participants: Participant[];
  showPeerLatency: boolean;
}) {
  const label = `${participants.length} more present`;
  const avatar = (
    <div
      className="flex size-7 items-center justify-center rounded-full border-2 border-bg-default bg-bg-subtle text-[10px] font-semibold text-content-subtle"
      title={showPeerLatency ? undefined : label}
    >
      +{participants.length}
    </div>
  );

  if (!showPeerLatency) return avatar;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            aria-label={label}
            className="rounded-full"
            role="status"
            tabIndex={0}
          />
        }
      >
        {avatar}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex-col items-stretch gap-1.5">
        {participants.map((participant) => (
          <div
            key={participant.id}
            className="flex items-center justify-between gap-3"
          >
            <span>
              {participant.name}
              {participant.isLocal ? ' (you)' : ''}
            </span>
            {participant.peer ? (
              <span className="min-w-14 text-right font-mono tabular-nums">
                {peerLatencyLabel(participant.peer)}
              </span>
            ) : null}
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Docked top chrome header for a board. A single, full-width top header docked at the top edge.
 */
export function BoardChrome({
  boardId,
  title,
  onBack,
  onRenameTitle,
  onEditIdentity,
  identity,
}: {
  boardId: string;
  title: string;
  onBack: () => void;
  onRenameTitle?: () => void;
  onEditIdentity?: () => void;
  identity: Identity | null;
}) {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const peers = usePresenceStore((s) => s.peers);
  const participants: Participant[] = [
    ...peers.map((peer) => ({
      id: `peer-${peer.clientId}`,
      name: peer.name,
      avatar: peer.avatar,
      isLocal: false,
      peer,
    })),
    ...(identity
      ? [
          {
            id: 'local-user',
            name: identity.name,
            avatar: identity.avatar,
            isLocal: true,
            peer: null,
          },
        ]
      : []),
  ];
  const visibleParticipants = participants.slice(0, MAX_VISIBLE_AVATARS);
  const overflowParticipants = participants.slice(MAX_VISIBLE_AVATARS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const renameTitle = identity?.isTutor ? onRenameTitle : undefined;

  const onExport = async () => {
    setExporting(true);
    try {
      await exportBoardToPng(title);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {/* Top-left panel: board navigation and the current page. */}
      <Surface className="touch-targets absolute top-[calc(1rem+env(safe-area-inset-top))] left-[calc(1rem+env(safe-area-inset-left))] z-20 flex h-10 items-center gap-0.5 p-1 shadow-hover">
        {/* Back navigates to the boards list, which is tutor-only. Students join
            via a shared link and aren't authenticated, so following it would
            bounce them to the login page — hide it for them. */}
        {identity?.isTutor && (
          <TooltipProvider delay={300}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Back to boards"
                    onClick={onBack}
                  />
                }
              >
                <ArrowLeft />
              </TooltipTrigger>
              <TooltipContent side="bottom">Back to boards</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {renameTitle ? (
          <TooltipProvider delay={300}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Rename board title"
                    onDoubleClick={renameTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        renameTitle();
                      }
                    }}
                    className="max-w-[clamp(5rem,20vw,12.5rem)] cursor-text px-2 font-semibold"
                  />
                }
              >
                <span className="truncate">{title}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Double-click to rename
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <span className="flex h-8 max-w-[clamp(5rem,20vw,12.5rem)] items-center truncate px-2 text-sm font-semibold text-content-emphasis">
            {title}
          </span>
        )}
        <span aria-hidden="true" className="px-0.5 text-xs text-content-muted">
          /
        </span>
        <PageMenu />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="More actions"
              />
            }
          >
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={8}
            className="w-44"
          >
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <Cog />
                Settings
              </DropdownMenuItem>
              {identity?.isTutor && (
                <DropdownMenuItem onClick={() => setNotesOpen(true)}>
                  <NotebookPen />
                  Student notes
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={toggle}>
                {theme === 'dark' ? <Sun /> : <Moon />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void onExport()}
                disabled={exporting}
              >
                <Download />
                Export PNG
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Surface>

      {/* Top-right panel (presence, session controls, and sharing). */}
      <Surface className="touch-targets absolute top-[calc(1rem+env(safe-area-inset-top))] right-[calc(1rem+env(safe-area-inset-right))] z-20 flex h-10 items-center gap-0.5 p-1 shadow-hover">
        <ConnectionIndicator />
        <div className="flex items-center px-1">
          <TooltipProvider delay={300}>
            <div className="flex -space-x-1.5">
              {visibleParticipants.map((participant) => {
                const label = participant.isLocal
                  ? `${participant.name} (you)`
                  : participant.name;
                const latencyLabel =
                  identity?.isTutor && participant.peer
                    ? peerLatencyLabel(participant.peer)
                    : null;
                let trigger;
                if (participant.isLocal && onEditIdentity) {
                  trigger = (
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={onEditIdentity}
                          className="rounded-full outline-none transition-opacity hover:opacity-80"
                          aria-label="Edit your icon"
                        />
                      }
                    >
                      <Avatar avatar={participant.avatar} />
                    </TooltipTrigger>
                  );
                } else if (participant.peer) {
                  const peer = participant.peer;
                  trigger = (
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={() => jumpToPeerViewport(peer)}
                          className="rounded-full outline-none transition-opacity hover:opacity-80"
                          aria-label={`Jump to ${participant.name}'s view`}
                        />
                      }
                    >
                      <Avatar avatar={participant.avatar} />
                    </TooltipTrigger>
                  );
                } else {
                  trigger = (
                    <TooltipTrigger render={<span />}>
                      <Avatar avatar={participant.avatar} />
                    </TooltipTrigger>
                  );
                }
                return (
                  <Tooltip key={participant.id}>
                    {trigger}
                    <TooltipContent side="bottom">
                      <span>{label}</span>
                      {latencyLabel ? (
                        <span className="font-mono tabular-nums">
                          · {latencyLabel}
                        </span>
                      ) : null}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
              {overflowParticipants.length > 0 ? (
                <OverflowAvatar
                  participants={overflowParticipants}
                  showPeerLatency={identity?.isTutor === true}
                />
              ) : null}
            </div>
          </TooltipProvider>
        </div>
        <MusicPlayer identity={identity} />
        <FollowControls identity={identity} />
        <AnimationControls identity={identity} />
        <ShareButton />
      </Surface>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {identity?.isTutor && (
        <BoardNotesDialog
          boardId={boardId}
          open={notesOpen}
          onOpenChange={setNotesOpen}
        />
      )}
    </>
  );
}
