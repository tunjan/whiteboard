import { useState, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { type Identity } from '@/collab/identity';
import { jumpToPeerViewport } from '@/collab/presence';
import {
  type PeerPresence,
  type VoicePresence,
  usePresenceStore,
} from '@/collab/use-presence-store';
import type { AttentionState } from '@/collab/attention-state';
import { useAttentionStore } from '@/collab/use-attention-store';
import { useFollowStore } from '@/collab/use-follow-store';
import { useVoiceStore } from '@/collab/voice/use-voice-store';
import { useFeaturesStore } from '@/board/features';
import { useDocumentsStore } from '@/canvas/use-documents-store';
import { useMusicPlaybackStore } from '@/music/use-music-playback-store';
import { ConnectionIndicator } from '@/components/connection-indicator';
import { DocumentsPanel } from '@/components/documents-panel';
import { FollowControls } from '@/components/follow-controls';
import { MusicPlayer } from '@/music/music-player';
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
import { CHROME_CONTROLS, INSTRUMENT } from '@/components/ui/surface';
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
// A phone gives every disc a 44px target, so four of them plus the tools would
// wrap the rail onto a second line. Two faces and a count keep it one row.
const MAX_VISIBLE_PARTICIPANTS_MOBILE = 2;

// Shared hit-area for the two clickable avatar triggers below (edit-identity,
// jump-to-peer): same shape as the avatar itself, no visible chrome of its own.
// Hover firms up the disc's ring; the ring is always 2px and only changes
// colour, so nothing moves or reflows under the cursor. It also raises the
// disc, because a stacked disc's recoloured ring is otherwise clipped by the
// neighbour lying on top of it.
const AVATAR_TRIGGER_CLASS =
  'relative rounded-full hover:z-10 focus-visible:z-10 [&_[data-slot=avatar]]:transition-[box-shadow] [&_[data-slot=avatar]]:duration-fast hover:[&_[data-slot=avatar]]:ring-border-strong motion-reduce:[&_[data-slot=avatar]]:transition-none';

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
}: {
  color: string;
  name: string;
  voice: VoiceDisplayState | null;
  attention: AttentionState;
}) {
  return (
    <Avatar
      size="sm"
      className={cn(
        'shrink-0 border-0',
        // Two edges, and they do different jobs. The 2px cutaway ring comes
        // from `AvatarGroup`, recoloured to the plate, and is what separates
        // one disc in the stack from the next. The hairline inside it is the
        // disc's own edge, which a flat colour field needs or it reads as a
        // hole in the plate rather than a token on it.
        //
        // Translucent ink rather than `--border`: the fill underneath is the
        // raw identity colour and spans the whole wheel, and a fixed grey
        // vanishes into the mid-tones. The primitive's `mix-blend-darken`
        // goes for the same reason — on a saturated fill it keeps the fill.
        'after:border after:border-black/20 after:mix-blend-normal dark:after:border-white/30',
        // Drifting is a fade, not a badge: the corner is spoken for by voice,
        // and a lapse in attention is a lull, so it reads as the disc receding.
        // The words are in the tooltip and the trigger's label either way.
        'transition-[opacity,filter] duration-fast motion-reduce:transition-none',
        attention === 'idle' && 'opacity-55',
        attention === 'away' && 'opacity-55 grayscale',
      )}
    >
      {/* White is safe on every entry rather than by luck: STUDENT_COLORS is
          luminance-matched, so the whole palette lands within 4.98:1–5.04:1
          against white, clearing AA for the 11px initial. Literal white rather
          than `fg-inverse` because the fill is the raw identity colour and no
          longer follows the theme. */}
      <AvatarFallback style={{ backgroundColor: color, color: '#FFFFFF' }}>
        {name.trim().charAt(0).toUpperCase() || '?'}
      </AvatarFallback>
      {/* Being in the call is ordinary, so it is neutral ink: subtle when idle,
          full-strength while speaking. Muted keeps its colour — it is the one
          voice state you need to notice, because you can be talking into a dead
          mic without knowing. Precedence matches the tooltip below. */}
      {voice?.inCall ? (
        <AvatarBadge
          aria-hidden="true"
          className={cn(
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
      className="size-6 border-0 ring-surface"
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
            className="relative rounded-full"
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

/**
 * A session tool's slot on the rail.
 *
 * Folded, the slot stays mounted: the music player owns a playing `<audio>`
 * element and the call owns live peer connections, and neither survives being
 * torn down and rebuilt because a chevron moved. It shrinks to no width
 * (`.wb-rail-slot` in index.css animates the fold) and goes `inert`, which
 * takes it out of the tab order, the accessibility tree and the roving
 * toolbar's arrow order.
 */
function ToolSlot({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="wb-rail-slot"
      data-folded={shown ? undefined : ''}
      inert={!shown}
    >
      <div>{children}</div>
    </div>
  );
}

/**
 * Who is here, and what is running between you.
 *
 * This is a plate, not a wash. The board's rule is that an edge means you can
 * press it, and every single thing in this cluster is something you aim at:
 * an avatar jumps to that person's view, the tools start and stop shared
 * sessions, Share brings someone new in. Only the top-left band — the board's
 * name and page — is read rather than pressed, and only that band stays flat.
 *
 * The rail shows what is *true*, and opens to show what is *possible*:
 *
 *   at rest   people · link │ follow · ‹
 *   in a call people · link │ follow · mic · ‹
 *   opened    people · link │ follow · mic files music share · ›
 *
 * Following is always there. Any other tool earns a place by having something
 * to report — the call is joined, a file arrived unread, music is playing.
 * Everything else, Share included, waits behind the chevron. So an idle board carries three
 * objects here instead of seven, and anything that appears on the rail
 * appeared because it started, which is the only thing the eye has to learn.
 */
export function SessionRail({
  identity,
  onEditIdentity,
}: {
  identity: Identity | null;
  onEditIdentity?: () => void;
}) {
  const rail = useRovingToolbar<HTMLDivElement>();
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const peers = usePresenceStore((s) => s.peers);
  // Empty for everyone but a tutor with attention alerts on, so every other
  // client renders `attentive` for all of them and nothing is shown.
  const attention = useAttentionStore((s) => s.peers);
  const voiceStatus = useVoiceStore((s) => s.status);
  const voiceMuted = useVoiceStore((s) => s.muted);
  const voiceSpeaking = useVoiceStore((s) => s.speaking);
  const following = useFollowStore((s) => s.following);
  const documents = useDocumentsStore((s) => s.documents);
  const unread = useDocumentsStore((s) => s.unread);
  const playback = useMusicPlaybackStore((s) => s.playback);

  const inCall = voiceStatus === 'joined' || voiceStatus === 'testing';
  // For the tutor, students following their view is the running fact.
  const hasFollowers =
    identity?.isTutor === true &&
    peers.some((peer) => !peer.isTutor && peer.following);
  const hasUnread = Object.keys(documents).some((id) => unread.has(id));
  const playing = playback.status === 'playing';
  const features = useFeaturesStore((state) => state.features);

  const localVoice: VoiceDisplayState | null =
    voiceStatus === 'joined'
      ? { inCall: true, muted: voiceMuted, speaking: voiceSpeaking }
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
  const maxVisible = isMobile
    ? MAX_VISIBLE_PARTICIPANTS_MOBILE
    : MAX_VISIBLE_PARTICIPANTS;
  const visibleParticipants = participants.slice(0, maxVisible);
  const overflowParticipants = participants.slice(maxVisible);

  return (
    <div
      ref={rail.ref}
      role="toolbar"
      aria-label="Session"
      aria-orientation="horizontal"
      data-arrive="down"
      style={{ '--arrive-i': 1 } as React.CSSProperties}
      onFocusCapture={rail.onFocusCapture}
      onKeyDown={rail.onKeyDown}
      // A plate here means something is running between you: the call is
      // joined, you are following, a file arrived, music is playing. Every
      // other reason a corner takes its plate — hover, focus, an open menu —
      // ends when you look away, so the one that persists carries a fact.
      data-awake={
        inCall || following || hasFollowers || hasUnread || playing
          ? ''
          : undefined
      }
      className={cn(
        CHROME_CONTROLS,
        INSTRUMENT,
        'absolute z-10 flex-wrap justify-end',
        // The right end of the top band, mirroring the board cluster on the
        // left and the bottom instruments: the same inset from its corner and
        // the same plate, dimmed at rest.
        'top-[calc(0.75rem+env(safe-area-inset-top))] right-[calc(0.75rem+env(safe-area-inset-right))]',
        // Free to wrap onto a second line when the rail is opened on a narrow
        // screen rather than pushing itself off the edge.
        'max-w-[calc(100vw-1.5rem)]',
        '[--chrome-hover:var(--color-tb-track)]',
      )}
    >
      {participants.length > 0 ? (
        <TooltipProvider delay={300}>
          <AvatarGroup className="items-center -space-x-1.5 px-1 *:data-[slot=avatar]:ring-surface">
            {visibleParticipants.map((participant) => {
              const label = participant.isLocal
                ? `${participant.name} (you)`
                : participant.name;
              const latencyLabel =
                identity?.isTutor && participant.peer
                  ? peerLatencyLabel(participant.peer)
                  : null;
              const disc = (
                <ParticipantAvatar
                  color={participant.color}
                  name={participant.name}
                  voice={participant.voice}
                  attention={participant.attention}
                />
              );
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
                      />
                    }
                  >
                    {disc}
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
                            ? `Jump to ${participant.name}'s view, ${attentionLabel(participant.attention)}`
                            : `Jump to ${participant.name}'s view`
                        }
                      />
                    }
                  >
                    {disc}
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
                      />
                    }
                  >
                    {disc}
                  </TooltipTrigger>
                );
              }
              return (
                <Tooltip key={participant.id}>
                  {trigger}
                  <TooltipContent side="bottom">
                    <span>{label}</span>
                    {attentionLabel(participant.attention) ? (
                      <span> · {attentionLabel(participant.attention)}</span>
                    ) : null}
                    {latencyLabel ? (
                      <span className="font-mono tabular-nums">
                        {' '}
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
      ) : null}

      {/* The link is a fact about the people, not a control, so it closes the
          presence run rather than opening the run of tools. */}
      <ConnectionIndicator />

      {/* Space, not a rule, parts the people from the tools: proximity already
          says they are two runs, and a hairline is one more thing to read. */}
      <span aria-hidden="true" className="w-1.5 shrink-0" />

      {/* Following is the one tool that never folds: it is how a student
          keeps up with the tutor, and how the tutor sees who is keeping up.
          It renders nothing when there is nobody to follow. */}
      <FollowControls identity={identity} toolbarItem />

      <ToolSlot shown={(open && features.voice) || inCall}>
        <VoiceControls identity={identity} toolbarItem />
      </ToolSlot>
      <ToolSlot shown={features.documents && (open || hasUnread)}>
        <DocumentsPanel identity={identity} toolbarItem />
      </ToolSlot>
      <ToolSlot shown={(open && features.music) || playing}>
        <MusicPlayer identity={identity} toolbarItem />
      </ToolSlot>
      {/* Sharing is done once per session, so it waits with the other tools
          rather than taking a permanent place on the board. */}
      <ToolSlot shown={open}>
        <ShareButton isTutor={identity?.isTutor === true} />
      </ToolSlot>

      {/* The rail opens the way it grows: leftward, into the board. No label,
          because the row it uncovers is the explanation. */}
      <TooltipProvider delay={300}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-toolbar-item
                tabIndex={-1}
                aria-expanded={open}
                aria-label={open ? 'Hide session tools' : 'Show session tools'}
                onClick={() => setOpen((value) => !value)}
              />
            }
          >
            <ChevronLeft
              aria-hidden="true"
              className={cn(
                'transition-transform duration-slow ease-[var(--ease-out-expo)] motion-reduce:transition-none',
                open && 'rotate-180',
              )}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {open ? 'Hide session tools' : 'Session tools'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
