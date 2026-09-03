import { type CSSProperties, useState } from 'react';
import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { type Identity } from '@/collab/identity';
import { jumpToPeerViewport } from '@/collab/presence';
import {
  type PeerPresence,
  type VoicePresence,
  usePresenceStore,
} from '@/collab/use-presence-store';
import type { AttentionState } from '@/collab/attention-state';
import { useAttentionStore } from '@/collab/use-attention-store';
import { useVoiceStore } from '@/collab/voice/use-voice-store';
import { BoardActionsMenu } from '@/components/board-actions-menu';
import { BoardNotesDialog } from '@/components/board-notes-dialog';
import { ConnectionIndicator } from '@/components/connection-indicator';
import { DocumentsPanel } from '@/components/documents-panel';
import { FollowControls } from '@/components/follow-controls';
import { KeyboardShortcutsDialog } from '@/components/keyboard-shortcuts-dialog';
import { MusicPlayer } from '@/music/music-player';
import { PageMenu } from '@/components/page-menu';
import { ShareButton } from '@/components/share-button';
import { VoiceControls } from '@/components/voice-controls';
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CHROME_CONTROLS, Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRovingToolbar } from '@/hooks/use-roving-toolbar';
import { cn } from '@/lib/utils';

const MAX_VISIBLE_PARTICIPANTS = 4;

// Shared hit-area for the two clickable avatar triggers below (edit-identity,
// jump-to-peer) — same shape as the avatar itself, no visible chrome of its own.
//
// Hover brings the disc to the front and firms up its ring. It deliberately
// does not fade: floating on the canvas, a translucent avatar shows whatever
// ink is underneath, so the hovered one looks *less* solid than its neighbours
// — the opposite of the "this one is live" read hover is meant to give.
//
// It also no longer lifts. A disc that jumps on hover is the one piece of the
// chrome that moves under the cursor, and the ring already answers "which one
// am I on" without shifting anything off its row. The ring is always 2px and
// only changes colour, so nothing reflows either.
const AVATAR_TRIGGER_CLASS =
  'relative z-[var(--avatar-stack-index)] rounded-full hover:z-10 focus-visible:z-10 [&_[data-slot=avatar]]:transition-[box-shadow] [&_[data-slot=avatar]]:duration-fast hover:[&_[data-slot=avatar]]:ring-border-strong motion-reduce:[&_[data-slot=avatar]]:transition-none';

interface Participant {
  id: string;
  name: string;
  color: string;
  isLocal: boolean;
  peer: PeerPresence | null;
  voice: VoiceDisplayState | null;
  /** Always `attentive` unless this is a tutor watching a student. */
  attention: AttentionState;
}

type VoiceDisplayState = Pick<VoicePresence, 'inCall' | 'muted' | 'speaking'>;

/** How the tutor's participant list words each attention state. */
function attentionLabel(attention: AttentionState): string | null {
  if (attention === 'away') return 'In another window';
  if (attention === 'idle') return 'Idle';
  return null;
}

function peerLatencyLabel(peer: PeerPresence): string {
  return peer.latencyMs === null ? 'Measuring…' : `${peer.latencyMs} ms`;
}

function ParticipantAvatar({
  color,
  name,
  voice,
  attention,
  overlapping = false,
}: {
  color: string;
  name: string;
  voice: VoiceDisplayState | null;
  attention: AttentionState;
  overlapping?: boolean;
}) {
  return (
    <Avatar
      // 24px. The discs no longer fill a control square themselves — the row
      // around them is 32px tall and centres them, so the cluster still sits
      // on the control grid without the avatar having to be that big.
      size="sm"
      className={cn(
        'shrink-0 border-0 after:hidden',
        // Overlapping discs need to be cut away from the one behind them, or
        // the fills blend into an unreadable smear. The cutaway has to be
        // whatever the board paints behind it to read as negative space rather
        // than as a border — and that is `bg-surface` (see Canvas.tsx), not the
        // `canvas` token, which is a different, greyer colour the board never
        // actually draws. Ringing in `canvas` is what put a grey halo around
        // every disc.
        //
        // The ring is always 2px — transparent when solo — so the hover state
        // only has to recolour it and nothing changes size under the cursor.
        'ring-2',
        overlapping ? 'ring-surface' : 'ring-transparent',
        // Drifting is a fade, not a badge. The corner is already spoken for by
        // voice, and a second marker there would collide; more to the point a
        // lapse in attention is a lull, so it should read as the disc receding
        // rather than as something new arriving. Idle dims; away drains the
        // identity colour out entirely, which is unmistakably "not here".
        // The words are in the tooltip and the trigger's label, so neither
        // state depends on reading the fade.
        'transition-[opacity,filter] duration-fast motion-reduce:transition-none',
        attention === 'idle' && 'opacity-55',
        attention === 'away' && 'opacity-55 grayscale',
      )}
    >
      {/* The identity colour at full strength, with the initial reversed out
          of it. A disc this small has very little area to carry a hue, and the
          old wash (28% of the colour mixed into the surface) spent most of that
          area on the surface instead — the discs read as grey chips.

          White is safe on every entry rather than by luck: STUDENT_COLORS is
          luminance-matched, so the whole palette lands within 4.98:1–5.04:1
          against white, clearing AA for the 11px initial. Literal white rather
          than `fg-inverse` because the fill is now the raw identity colour and
          no longer follows the theme — a token that flips would put dark ink on
          a mid-tone fill in dark mode. */}
      <AvatarFallback style={{ backgroundColor: color, color: '#FFFFFF' }}>
        {name.trim().charAt(0).toUpperCase() || '?'}
      </AvatarFallback>
      {/* Being in the call is ordinary, so it is neutral ink: subtle when
          idle, full-strength while speaking. Muted keeps its colour — it is
          the one voice state you need to notice, because you can be talking
          into a dead mic without knowing.

          Precedence matches the tooltip below (muted before speaking); the
          badge used to test speaking first and could report a muted
          participant as live. */}
      {voice?.inCall ? (
        <AvatarBadge
          aria-hidden="true"
          className={cn(
            // Same cutaway as the disc's own ring, for the same reason.
            'ring-surface',
            voice.muted
              ? 'bg-danger-fg bg-blend-normal'
              : voice.speaking
                ? 'bg-fg bg-blend-normal'
                : 'bg-fg-subtle bg-blend-normal',
          )}
        />
      ) : null}
    </Avatar>
  );
}

function OverflowParticipants({
  participants,
  showPeerLatency,
}: {
  participants: Participant[];
  showPeerLatency: boolean;
}) {
  const label = `${participants.length} more present`;
  const badge = (
    <AvatarGroupCount
      className="z-0 size-6 border-0 ring-2 ring-surface hover:z-10"
      // Tail of the stack: it only ever renders alongside others, and nothing
      // sits to its right to overlap it.
      title={showPeerLatency ? undefined : label}
    >
      +{participants.length}
    </AvatarGroupCount>
  );

  if (!showPeerLatency) return badge;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            aria-label={label}
            data-toolbar-item
            className="relative z-0 rounded-full hover:z-10 focus-visible:z-10"
            role="status"
            tabIndex={-1}
          />
        }
      >
        {badge}
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
            <span className="flex items-center gap-2">
              {attentionLabel(participant.attention) ? (
                <span className="text-fg-secondary">
                  {attentionLabel(participant.attention)}
                </span>
              ) : null}
              {participant.peer ? (
                <span className="min-w-14 text-right font-mono tabular-nums">
                  {peerLatencyLabel(participant.peer)}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function SessionUtilities({
  identity,
  compact,
}: {
  identity: Identity | null;
  compact: boolean;
}) {
  if (!compact) {
    return (
      <>
        <MusicPlayer identity={identity} toolbarItem />
        <FollowControls identity={identity} toolbarItem />
        <DocumentsPanel identity={identity} toolbarItem />
        <VoiceControls identity={identity} toolbarItem />
      </>
    );
  }

  return (
    <Popover>
      <TooltipProvider delay={300}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    data-toolbar-item
                    tabIndex={-1}
                    aria-label="Open session tools"
                  />
                }
              />
            }
          >
            <SlidersHorizontal aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Session tools</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {/* Same four controls as the docked panel, just relocated — so they carry
          the same chrome conventions (hairline icons, coarse-pointer targets)
          rather than reverting to stock weights outside a chrome Surface. */}
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className={cn(
          CHROME_CONTROLS,
          'w-[min(19rem,calc(100vw-1rem))]',
        )}
      >
        <PopoverHeader>
          <PopoverTitle>Session tools</PopoverTitle>
          <PopoverDescription>
            Shared media and collaboration controls.
          </PopoverDescription>
        </PopoverHeader>
        <div className="grid grid-cols-2 gap-0.5 [&_[data-slot=button]]:w-full [&_[data-slot=button]]:justify-start [&_[data-slot=popover-trigger]]:w-full [&_[data-slot=popover-trigger]]:justify-start [&_[data-slot=toggle]]:w-full [&_[data-slot=toggle]]:justify-start">
          <MusicPlayer identity={identity} showLabel />
          <FollowControls identity={identity} showLabel />
          <DocumentsPanel identity={identity} showLabel />
          <VoiceControls identity={identity} showLabel />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Docked top chrome header for a board. Two panels attached to the viewport
 * corners, plus a free-floating presence cluster:
 *
 * Left  — board navigation: back → board title → page (breadcrumb pattern, §12.8)
 * Right — session controls: connection, collaboration tools, share
 * Beside the right panel — participant avatars, floating free of any panel
 *
 * Neither panel is a card: no border and no shadow, because they're flush to
 * the screen edge and the chrome should read as part of the window frame
 * rather than as something hovering over it. What they do carry is the board
 * behind them, blurred (`wb-chrome-blur`), turned in at the one corner that
 * faces the canvas. Their ghost controls hover to `panel` instead, since the
 * hover fill has to stay one step off the canvas they sit on.
 *
 * The presence cluster is deliberately *not* panelled: who is on the board is
 * live state rather than a control, so the discs sit directly on the canvas.
 * Their overlap rings are `ring-surface` — the colour the canvas actually
 * paints — so the cutaway between stacked avatars reads as negative space, not
 * as a border.
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
  const isMobile = useIsMobile();
  const sessionToolbar = useRovingToolbar<HTMLDivElement>();
  const presenceToolbar = useRovingToolbar<HTMLDivElement>();
  const peers = usePresenceStore((s) => s.peers);
  // Empty for everyone but a tutor with attention alerts on, so every other
  // client renders `attentive` for all of them and nothing is shown.
  const attention = useAttentionStore((s) => s.peers);
  const voiceStatus = useVoiceStore((s) => s.status);
  const voiceMuted = useVoiceStore((s) => s.muted);
  const voiceSpeaking = useVoiceStore((s) => s.speaking);
  const localVoice: VoiceDisplayState | null =
    voiceStatus === 'joined'
      ? {
          inCall: true,
          muted: voiceMuted,
          speaking: voiceSpeaking,
        }
      : null;
  const participants: Participant[] = [
    ...peers.map((peer) => ({
      id: `peer-${peer.clientId}`,
      name: peer.name,
      color: peer.color,
      isLocal: false,
      peer,
      voice: peer.voice,
      attention: attention.get(peer.clientId)?.state ?? 'attentive',
    })),
    ...(identity
      ? [
          {
            id: 'local-user',
            name: identity.name,
            color: identity.color,
            isLocal: true,
            peer: null,
            voice: localVoice,
            // Deliberately never self-reported: this is the tutor's read of
            // other people, not a mirror anyone sees pointed at themselves.
            attention: 'attentive' as const,
          },
        ]
      : []),
  ];
  const visibleParticipants = participants.slice(0, MAX_VISIBLE_PARTICIPANTS);
  const overflowParticipants = participants.slice(MAX_VISIBLE_PARTICIPANTS);
  // A lone avatar has nothing to overlap, so it stays flat and evenly spaced;
  // the stack only forms once there is a second person on the board.
  const avatarsOverlap = participants.length > 1;
  // Highest z-index goes to the leftmost avatar and descends rightward, so the
  // overflow count (rendered last) ends up underneath everything at 0.
  const stackDepth = visibleParticipants.length;
  const [notesOpen, setNotesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const renameTitle = identity?.isTutor ? onRenameTitle : undefined;

  return (
    <>
      {/* ── Top-left: board navigation ──────────────────────────────────────
          Breadcrumb layout (§12.8): Back → Board title → / → Current page → ⋯
          Board title is the "ancestor" (text-fg-secondary, muted).
          Current page name is handled by PageMenu (text-fg, full weight).
          Separator is a slash. */}
      <Surface
        role="navigation"
        aria-label="Board navigation"
        mode="docked"
        chrome
        className="wb-chrome-blur absolute top-0 left-0 flex max-w-[calc(100vw-0.5rem)] items-center gap-1 rounded-none rounded-br-xl border-0 bg-transparent p-1.5 pt-[calc(0.5rem+env(safe-area-inset-top))] pl-[calc(0.5rem+env(safe-area-inset-left))] [--chrome-hover:var(--color-panel)] md:max-w-[50vw]"
      >
        {/* Back — tutor-only: students join via shared link and aren't authenticated */}
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

        {/* Board title — ancestor node of the breadcrumb.
            Muted (text-fg-secondary) because it is context, not the current location.
            Tutors can click to rename; students see a read-only label. */}
        {renameTitle ? (
          <TooltipProvider delay={300}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Rename board title"
                    onClick={renameTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        renameTitle();
                      }
                    }}
                    // No `cursor-text`: this opens a rename dialog rather than
                    // editing in place, and a caret cursor promised an inline
                    // field that never appears.
                    className="max-w-[clamp(5rem,20vw,12.5rem)] px-2 font-medium text-fg-secondary"
                  />
                }
              >
                <span className="truncate">{title}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">Rename board</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <span className="flex h-8 max-w-[clamp(5rem,20vw,12.5rem)] items-center truncate px-2 text-sm font-medium text-fg-secondary">
            {title}
          </span>
        )}

        {/* Breadcrumb separator — a typed slash rather than a chevron, so the
            only arrow-like glyph left in this panel is the back button. */}
        <span aria-hidden="true" className="shrink-0 text-sm text-fg-subtle">
          /
        </span>

        {/* Current page — full-weight, text-fg; opens the page picker */}
        <PageMenu />

        {/* Overflow — board dialogs, image output, preferences */}
        <BoardActionsMenu
          title={title}
          isTutor={identity?.isTutor === true}
          onOpenNotes={() => setNotesOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />
      </Surface>

      {/* ── Top-right: floating presence cluster + docked session panel ──── */}
      <div className="absolute top-[calc(2.75rem+env(safe-area-inset-top))] right-0 flex max-w-[calc(100vw-0.5rem)] items-start gap-2 [@media(pointer:coarse)]:top-[calc(3.5rem+env(safe-area-inset-top))] md:top-0 md:[@media(pointer:coarse)]:top-0">
        {participants.length > 0 ? (
          <div
            ref={presenceToolbar.ref}
            role="toolbar"
            aria-label="People on this board"
            aria-orientation="horizontal"
            onFocusCapture={presenceToolbar.onFocusCapture}
            onKeyDown={presenceToolbar.onKeyDown}
            // No surface of its own: the discs sit straight on the canvas.
            // `touch-targets` is what the session panel's `chrome` used to give
            // these buttons — kept so coarse pointers still get 44px hit areas.
            //
            // Match the session row's top padding at each breakpoint. The row
            // is a full 32px control square that centres the 24px discs, so its
            // centreline now matches the 32px controls beside it.
            className="touch-targets mt-1.5 flex h-8 shrink-0 items-center md:mt-[calc(0.5rem+env(safe-area-inset-top))]"
          >
            <TooltipProvider delay={300}>
              <AvatarGroup
                // 6px on a 24px disc is the same quarter-overlap `-space-x-2`
                // gave the old 32px one.
                className={avatarsOverlap ? '-space-x-1.5' : 'gap-0 space-x-0'}
              >
                {visibleParticipants.map((participant, index) => {
                  const label = participant.isLocal
                    ? `${participant.name} (you)`
                    : participant.name;
                  const latencyLabel =
                    identity?.isTutor && participant.peer
                      ? peerLatencyLabel(participant.peer)
                      : null;
                  const triggerStyle = {
                    '--avatar-stack-index': stackDepth - index,
                  } as CSSProperties;
                  let trigger;
                  if (participant.isLocal && onEditIdentity) {
                    trigger = (
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            data-toolbar-item
                            tabIndex={-1}
                            onClick={onEditIdentity}
                            className={AVATAR_TRIGGER_CLASS}
                            aria-label="Edit your name"
                            style={triggerStyle}
                          />
                        }
                      >
                        <ParticipantAvatar
                          color={participant.color}
                          name={participant.name}
                          voice={participant.voice}
                          attention={participant.attention}
                          overlapping={avatarsOverlap}
                        />
                      </TooltipTrigger>
                    );
                  } else if (participant.peer) {
                    const peer = participant.peer;
                    trigger = (
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            data-toolbar-item
                            tabIndex={-1}
                            onClick={() => jumpToPeerViewport(peer)}
                            className={AVATAR_TRIGGER_CLASS}
                            aria-label={
                              attentionLabel(participant.attention)
                                ? `Jump to ${participant.name}'s view — ${attentionLabel(participant.attention)}`
                                : `Jump to ${participant.name}'s view`
                            }
                            style={triggerStyle}
                          />
                        }
                      >
                        <ParticipantAvatar
                          color={participant.color}
                          name={participant.name}
                          voice={participant.voice}
                          attention={participant.attention}
                          overlapping={avatarsOverlap}
                        />
                      </TooltipTrigger>
                    );
                  } else {
                    trigger = (
                      <TooltipTrigger
                        render={
                          <span
                            role="img"
                            aria-label={label}
                            className={AVATAR_TRIGGER_CLASS}
                            style={triggerStyle}
                          />
                        }
                      >
                        <ParticipantAvatar
                          color={participant.color}
                          name={participant.name}
                          voice={participant.voice}
                          attention={participant.attention}
                          overlapping={avatarsOverlap}
                        />
                      </TooltipTrigger>
                    );
                  }
                  return (
                    <Tooltip key={participant.id}>
                      {trigger}
                      <TooltipContent side="bottom">
                        <span>{label}</span>
                        {attentionLabel(participant.attention) ? (
                          <span>
                            {' '}
                            · {attentionLabel(participant.attention)}
                          </span>
                        ) : null}
                        {latencyLabel ? (
                          <span className="font-mono tabular-nums">
                            · {latencyLabel}
                          </span>
                        ) : null}
                        {participant.voice?.inCall ? (
                          <span>
                            {' '}
                            ·{' '}
                            {participant.voice.muted
                              ? 'Voice muted'
                              : participant.voice.speaking
                                ? 'Speaking'
                                : 'Mic listening'}
                          </span>
                        ) : null}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                {overflowParticipants.length > 0 ? (
                  <OverflowParticipants
                    participants={overflowParticipants}
                    showPeerLatency={identity?.isTutor === true}
                  />
                ) : null}
              </AvatarGroup>
            </TooltipProvider>
          </div>
        ) : null}

        {/* No panel and no per-control chip: the controls stand on the blurred
            board, the same ground the top-left panel gets. The row only turns
            its corners in where it is not flush to an edge — bottom-left
            always, and top-left too below `md`, where it hangs clear of the
            top edge to clear the navigation panel. */}
        <div
          ref={sessionToolbar.ref}
          role="toolbar"
          aria-label="Session controls"
          aria-orientation="horizontal"
          onFocusCapture={sessionToolbar.onFocusCapture}
          onKeyDown={sessionToolbar.onKeyDown}
          className={cn(
            CHROME_CONTROLS,
            'wb-chrome-blur relative flex shrink-0 items-center gap-1.5 rounded-l-xl p-1.5 pr-[calc(0.5rem+env(safe-area-inset-right))] [--chrome-hover:var(--color-panel)] md:rounded-tl-none md:pt-[calc(0.5rem+env(safe-area-inset-top))]',
          )}
        >
          <ConnectionIndicator />
          <SessionUtilities identity={identity} compact={isMobile} />
          <ShareButton />
        </div>
      </div>

      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
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
