import { memo, useEffect, useId, useRef, useState } from 'react';
import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import {
  AudioLines,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
  TriangleAlert,
} from 'lucide-react';
import { textOnColor, type Identity } from '@/collab/identity';
import {
  joinVoice,
  leaveVoice,
  retryFailedVoiceConnections,
  setGateThreshold,
  setMuted,
  setNoiseCancellation,
  startVoiceTest,
  stopVoiceTest,
} from '@/collab/voice/voice-session';
import {
  type VoicePeerStatus,
  type VoiceStatus,
  useVoiceStore,
} from '@/collab/voice/use-voice-store';
import { playVoiceSound, primeVoiceSounds } from '@/collab/voice/voice-sounds';
import {
  type PeerPresence,
  type VoicePresence,
  usePresenceStore,
} from '@/collab/use-presence-store';
import { Button, buttonVariants } from '@/components/ui/button';
import { LevelMeter } from '@/components/ui/level-meter';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CHROME_CONTROLS, HOVER_REVEAL } from '@/components/ui/surface';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  MAX_VOICE_LEVEL_DB,
  MIN_VOICE_LEVEL_DB,
  voiceLevelPercent,
} from '@/collab/voice/voice-gate';
import { cn } from '@/lib/utils';

interface VoiceControlsProps {
  identity: Identity | null;
  showLabel?: boolean;
  toolbarItem?: boolean;
}

interface VoiceCallPeer {
  clientId: number;
  name: string;
  color: string;
  voice: VoicePresence;
}

/**
 * What a person's row has to report, if anything.
 *
 * `listening` is the null state and it is the state nearly every row is in
 * nearly all of the time — so it is drawn as nothing at all. A column of four
 * rows each saying "Listening" is four lines of text carrying no information,
 * and it buries the one row that does. Silence means fine; ink means
 * something to know.
 */
type ParticipantState =
  'listening' | 'speaking' | 'muted' | 'pending' | 'failed';

/** Shared by your own row and every peer row — one rule, one wording. */
function participantState(
  muted: boolean,
  speaking: boolean,
  connection?: VoicePeerStatus,
): { state: ParticipantState; label: string } {
  if (connection === 'failed') return { state: 'failed', label: 'Failed' };
  if (connection === 'disconnected')
    return { state: 'pending', label: 'Reconnecting' };
  if (connection === 'connecting')
    return { state: 'pending', label: 'Connecting' };
  if (muted) return { state: 'muted', label: 'Muted' };
  return speaking
    ? { state: 'speaking', label: 'Speaking' }
    : { state: 'listening', label: 'Listening' };
}

/**
 * The session in one phrase, for the live region only.
 *
 * It used to be printed across the top of the panel. Every one of its states
 * has a better home now — "Joining" belongs on the key you pressed to join,
 * "3 in call" is the list of three people directly below it, "Not connected"
 * is the Join key being the only thing on offer — so on screen the header was
 * a tier restating its own contents. A screen reader has no such layout, so
 * the sentence stays, unseen and polite.
 */
function sessionStatus(status: VoiceStatus, peopleInCall: number): string {
  switch (status) {
    case 'connecting':
      return 'Joining voice chat';
    case 'test-connecting':
      return 'Starting microphone test';
    case 'testing':
      return 'Microphone test running';
    case 'joined':
      return peopleInCall === 1
        ? 'In voice chat, just you'
        : `In voice chat, ${peopleInCall} people`;
    default:
      return 'Not in voice chat';
  }
}

let cachedCallPeers: VoiceCallPeer[] = [];

function selectCallPeers({
  peers,
}: {
  peers: PeerPresence[];
}): VoiceCallPeer[] {
  const next = peers
    .filter(
      (peer): peer is PeerPresence & { voice: VoicePresence } =>
        peer.voice?.inCall === true,
    )
    .map(({ clientId, name, color, voice }) => ({
      clientId,
      name,
      color,
      voice,
    }));
  if (
    next.length === cachedCallPeers.length &&
    next.every((peer, index) => {
      const previous = cachedCallPeers[index];
      return (
        previous?.clientId === peer.clientId &&
        previous.name === peer.name &&
        previous.color === peer.color &&
        previous.voice === peer.voice
      );
    })
  ) {
    return cachedCallPeers;
  }
  cachedCallPeers = next;
  return next;
}

/**
 * Voice chat.
 *
 * Two zones, the same grammar the music panel uses, so the board's popovers
 * read alike:
 *
 *   above the hairline   the call — who is in it, and getting in or out
 *   below it, on panel   your microphone — its level, its gate, its filter
 *
 * The split is what makes the panel small. Everything below the line is set
 * once and then never thought about again, so it stops competing with the two
 * controls that are actually pressed in a call: mute, and leave.
 *
 * Mute is the loudest thing on the panel because it is the one control people
 * hit mid-sentence, and because talking into a dead microphone is the only
 * mistake here that wastes somebody else's time. Leaving is neither urgent nor
 * ambiguous, so it is a key beside it rather than a peer of it.
 */
export const VoiceControls = memo(function VoiceControls({
  identity,
  showLabel = false,
  toolbarItem = false,
}: VoiceControlsProps) {
  const noiseCancellationId = useId();
  const [open, setOpen] = useState(false);
  const status = useVoiceStore((state) => state.status);
  const muted = useVoiceStore((state) => state.muted);
  const speaking = useVoiceStore((state) => state.speaking);
  const noiseCancellation = useVoiceStore((state) => state.noiseCancellation);
  const error = useVoiceStore((state) => state.error);
  const peerStatuses = useVoiceStore((state) => state.peerStatuses);
  const previousFeedbackState = useRef({ status, muted, error });
  const callPeers = usePresenceStore(selectCallPeers);
  const hasFailedPeers = [...peerStatuses.values()].some(
    (peerStatus) => peerStatus === 'failed',
  );
  const engaged = status === 'joined' || status === 'testing';
  const joining = status === 'connecting';
  const testing = status === 'testing';
  const testStarting = status === 'test-connecting';
  const sessionLabel = sessionStatus(status, callPeers.length + 1);
  // The trigger is the only voice affordance visible with the panel closed, so
  // its label stays about your microphone rather than about the session.
  const triggerLabel =
    status === 'idle'
      ? 'Voice chat'
      : status === 'joined'
        ? `Voice chat: ${participantState(muted, speaking).label}`
        : `Voice chat: ${sessionLabel}`;

  useEffect(() => {
    const previous = previousFeedbackState.current;
    previousFeedbackState.current = { status, muted, error };

    if (error && error !== previous.error) {
      playVoiceSound('error');
    } else if (status === 'joined' && previous.status !== 'joined') {
      playVoiceSound('join');
    } else if (status === 'idle' && previous.status === 'joined') {
      playVoiceSound('leave');
    } else if (
      status === 'joined' &&
      previous.status === 'joined' &&
      muted !== previous.muted
    ) {
      playVoiceSound(muted ? 'mute' : 'unmute');
    }
  }, [error, muted, status]);

  if (!identity) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) primeVoiceSounds();
        if (!nextOpen && (testStarting || testing)) stopVoiceTest();
      }}
    >
      <TooltipProvider delay={300}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                data-toolbar-item={toolbarItem || undefined}
                tabIndex={toolbarItem ? -1 : undefined}
                aria-label={triggerLabel}
                aria-pressed={engaged}
                // In the call is an on/off state, so it takes the chrome's
                // quiet pressed idiom. Muted keeps its colour: it is the one
                // condition here that costs you something if you miss it.
                className={cn(
                  buttonVariants({
                    variant: 'ghost',
                    size: showLabel ? 'sm' : 'icon-sm',
                  }),
                  'relative border',
                  engaged && 'border-border bg-panel text-fg',
                  engaged &&
                    muted &&
                    'border-danger-border bg-danger-bg text-danger',
                )}
              />
            }
          >
            {joining || testStarting ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : testing ? (
              <AudioLines aria-hidden="true" />
            ) : status === 'joined' && muted ? (
              <MicOff aria-hidden="true" className="text-danger" />
            ) : status === 'joined' && speaking ? (
              // The board's one mark for "audio is happening here, now" — the
              // same figure the music rail uses, and the same one the talking
              // person's row carries inside the panel.
              <LevelMeter className="size-4" />
            ) : (
              <Mic aria-hidden="true" />
            )}
            {showLabel ? <span>Voice</span> : null}
          </TooltipTrigger>
          <TooltipContent side="bottom">{triggerLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={10}
        className={cn(
          CHROME_CONTROLS,
          'w-[min(20rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0',
        )}
      >
        {/* The key that opened this says "Voice chat"; repeating it in a
            heading spends a tier on a word already on screen. Kept for the
            accessible name, which has no such context, and with it the running
            commentary the deleted header used to carry. */}
        <PopoverTitle className="sr-only">Voice chat</PopoverTitle>
        <span role="status" aria-live="polite" className="sr-only">
          {sessionLabel}
        </span>

        <div className="flex flex-col gap-3 p-3">
          {error ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger"
            >
              <span className="min-w-0">{error}</span>
              {status === 'joined' && hasFailedPeers ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={retryFailedVoiceConnections}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}

          {status === 'joined' ? (
            <ul
              aria-label="People in voice chat"
              className="-my-1 flex max-h-52 flex-col overflow-y-auto"
            >
              <VoiceParticipant
                name={`${identity.name} (you)`}
                color={identity.color}
                local
                muted={muted}
                speaking={speaking}
              />
              {callPeers.map((peer) => (
                <VoiceParticipant
                  key={peer.clientId}
                  name={peer.name}
                  color={peer.color}
                  muted={peer.voice.muted}
                  speaking={peer.voice.speaking}
                  connectionStatus={peerStatuses.get(peer.clientId)}
                />
              ))}
            </ul>
          ) : null}

          {status === 'joined' ? (
            <div className="flex items-center gap-2">
              {/* Full width, and the only filled key in the panel. Colour says
                  which way it is pointing: muted is the state that costs you
                  something, so it is the state that is marked. */}
              <Button
                type="button"
                variant="outline"
                aria-pressed={muted}
                aria-label={
                  muted
                    ? 'Unmute microphone, currently muted'
                    : 'Mute microphone'
                }
                className={cn(
                  'h-10 flex-1 text-sm',
                  muted &&
                    'border-danger-border bg-danger-bg text-danger hover:bg-danger-bg',
                )}
                onClick={() => setMuted(!muted)}
              >
                {muted ? (
                  <MicOff aria-hidden="true" />
                ) : (
                  <Mic aria-hidden="true" />
                )}
                {muted ? 'Unmute' : 'Mute'}
              </Button>
              {/* Leaving is routine and reversible, so it is a key beside the
                  one you actually press rather than a second half of the row. */}
              <TooltipProvider delay={300}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-10"
                        aria-label="Leave voice chat"
                        onClick={leaveVoice}
                      />
                    }
                  >
                    <PhoneOff aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Leave</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {/* Every transient state is reported by the key that caused it,
                  which is why there is no status line above. */}
              <Button
                type="button"
                className="h-10 w-full text-sm"
                disabled={joining}
                onClick={() => void joinVoice()}
              >
                {joining ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Mic aria-hidden="true" />
                )}
                {joining
                  ? 'Joining'
                  : error
                    ? 'Try again'
                    : // States the behaviour rather than describing it in a
                      // sentence above the key.
                      'Join muted'}
              </Button>
              {joining ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-fg-muted"
                  onClick={leaveVoice}
                >
                  Cancel
                </Button>
              ) : (
                // Testing has a visible result now: the meter below wakes up.
                // So the key only has to start it.
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-fg-muted"
                  disabled={testStarting}
                  onClick={
                    testing ? stopVoiceTest : () => void startVoiceTest()
                  }
                >
                  {testStarting ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : (
                    <AudioLines aria-hidden="true" />
                  )}
                  {testStarting
                    ? 'Starting test'
                    : testing
                      ? 'Stop mic test'
                      : 'Test microphone'}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Below the line: your microphone. Nobody else is affected by
            anything here, and nothing here changes during a call — which is
            exactly why it can sit at the bottom on its own ground instead of
            taking two tiers out of the middle of the panel. */}
        <div className="group/chrome flex flex-col border-t border-border-subtle bg-panel px-3 py-1.5 [--chrome-hover:var(--color-surface)]">
          <MicRail />
          <label
            htmlFor={noiseCancellationId}
            className="flex h-8 items-center justify-between gap-3"
          >
            <span className="text-xs text-fg-secondary">
              Noise cancellation
            </span>
            <Switch
              id={noiseCancellationId}
              size="sm"
              checked={noiseCancellation}
              onCheckedChange={setNoiseCancellation}
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
});

/**
 * Your microphone, as one object.
 *
 * The bar is the live input level and the mark standing in it is the level
 * your voice has to clear before anything is transmitted. They were two
 * stacked controls that merely lined up; making them one thing means they
 * cannot stop lining up, and it means the gate — an expert setting almost
 * nobody should ever touch — costs no height at all, because it rides on a
 * meter you want anyway.
 *
 * The reading in decibels is the only jargon in the panel, so it stays out of
 * sight until you reach for the bar.
 */
function MicRail() {
  const status = useVoiceStore((state) => state.status);
  const inputLevelDb = useVoiceStore((state) => state.inputLevelDb);
  const speaking = useVoiceStore((state) => state.speaking);
  const gateThresholdDb = useVoiceStore((state) => state.gateThresholdDb);
  const live = status === 'joined' || status === 'testing';

  return (
    <div className="flex h-8 items-center gap-2">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center',
          live ? 'text-fg-muted' : 'text-fg-subtle',
        )}
      >
        <Mic className="size-3.5" />
      </span>

      <SliderPrimitive.Root
        // Centre alignment: the mark's middle is the threshold, and the fill
        // behind it is a percentage of the same track, so a voice that reaches
        // the mark is a voice that opens the gate. Nothing to keep in step.
        thumbAlignment="center"
        min={MIN_VOICE_LEVEL_DB}
        max={MAX_VOICE_LEVEL_DB}
        step={1}
        value={gateThresholdDb}
        aria-label="Voice activation level"
        aria-valuetext={`${formatDb(gateThresholdDb)}, microphone ${
          speaking ? 'open' : 'closed'
        }`}
        onValueChange={(nextValue) =>
          setGateThreshold(Array.isArray(nextValue) ? nextValue[0]! : nextValue)
        }
        className="min-w-0 flex-1"
      >
        <SliderPrimitive.Control className="relative flex h-6 w-full touch-none items-center select-none">
          <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-sunken select-none">
            <span
              aria-hidden="true"
              style={{
                width: `${live ? voiceLevelPercent(inputLevelDb) : 0}%`,
              }}
              className={cn(
                'block h-full rounded-full',
                'transition-[width] duration-75 motion-reduce:transition-none',
                speaking ? 'bg-check' : 'bg-border-strong',
              )}
            />
          </SliderPrimitive.Track>
          {/* A hairline mark, in a hit area wide enough to grab. Nothing is
              lifted: on this board a mark is a change of fill. */}
          <SliderPrimitive.Thumb className="flex h-6 w-4 items-center justify-center rounded-compact ring-focus/50 select-none has-[:focus-visible]:ring-4">
            <span
              aria-hidden="true"
              className="h-3.5 w-0.5 rounded-full bg-fg"
            />
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Control>
      </SliderPrimitive.Root>

      <span
        aria-hidden="true"
        className={cn(
          HOVER_REVEAL,
          'w-12 shrink-0 text-right font-mono text-2xs tabular-nums text-fg-subtle',
        )}
      >
        {formatDb(gateThresholdDb)}
      </span>
    </div>
  );
}

/**
 * Typographic minus, and a thin space before the unit — a mono space between
 * number and unit is nearly a full character wide and pulls the two apart.
 */
function formatDb(db: number) {
  return `${db.toString().replace('-', '−')} dB`;
}

function VoiceParticipant({
  name,
  color,
  local = false,
  muted,
  speaking,
  connectionStatus,
}: {
  name: string;
  color: string;
  local?: boolean;
  muted: boolean;
  speaking: boolean;
  connectionStatus?: VoicePeerStatus;
}) {
  const { state, label } = participantState(muted, speaking, connectionStatus);
  return (
    <li className="flex h-9 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold ring-1 ring-border"
        style={{ backgroundColor: color, color: textOnColor(color) }}
      >
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          state === 'speaking' ? 'font-medium text-fg' : 'text-fg-secondary',
        )}
      >
        {name}
      </span>
      {/* The word is always there for a screen reader; on screen only the
          states worth a glance draw anything. */}
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-end gap-1.5"
      >
        {state === 'speaking' ? (
          <LevelMeter className="text-fg" />
        ) : state === 'muted' ? (
          // Your own dead microphone is worth colour; somebody else's is
          // simply a fact about them.
          <MicOff
            className={cn('size-3.5', local ? 'text-danger' : 'text-fg-subtle')}
          />
        ) : state === 'pending' ? (
          <LoaderCircle className="size-3.5 animate-spin text-fg-muted motion-reduce:animate-none" />
        ) : state === 'failed' ? (
          <span className="flex items-center gap-1.5 text-xs text-danger">
            <TriangleAlert className="size-3.5" />
            {label}
          </span>
        ) : null}
      </span>
    </li>
  );
}
