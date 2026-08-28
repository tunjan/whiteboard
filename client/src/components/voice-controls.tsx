import { memo, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AudioLines,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
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
import {
  playVoiceSound,
  primeVoiceSounds,
} from '@/collab/voice/voice-sounds';
import {
  type PeerPresence,
  type VoicePresence,
  usePresenceStore,
} from '@/collab/use-presence-store';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CHROME_CONTROLS } from '@/components/ui/surface';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Toggle } from '@/components/ui/toggle';
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
 * Every state in this panel resolves to one of four tones, and a tone is the
 * only thing that carries colour. Muted is the sole condition that costs you
 * something if you miss it, so it is the sole condition that gets `danger` —
 * the same rule the trigger button follows.
 */
type StatusTone = 'idle' | 'pending' | 'active' | 'danger';

interface StatusInfo {
  tone: StatusTone;
  label: string;
}

const STATUS_DOT: Record<StatusTone, string> = {
  idle: 'bg-border-strong',
  pending: 'bg-border-strong',
  active: 'bg-fg',
  danger: 'bg-danger',
};

const STATUS_TEXT: Record<StatusTone, string> = {
  idle: 'text-fg-muted',
  pending: 'text-fg-muted',
  active: 'text-fg',
  danger: 'text-danger',
};

/** Shared by your own row, every peer row, and the header — one rule, one wording. */
function participantStatus(
  muted: boolean,
  speaking: boolean,
  connection?: VoicePeerStatus,
): StatusInfo {
  if (connection === 'failed') return { tone: 'danger', label: 'Failed' };
  if (connection === 'disconnected')
    return { tone: 'pending', label: 'Reconnecting' };
  if (connection === 'connecting')
    return { tone: 'pending', label: 'Connecting' };
  if (muted) return { tone: 'danger', label: 'Muted' };
  return speaking
    ? { tone: 'active', label: 'Speaking' }
    : { tone: 'idle', label: 'Listening' };
}

/**
 * The header reports the *session*, never your microphone. Voice activity
 * already has two homes — your row in the list and the input meter — and
 * printing "Speaking" twice, 90px apart, was the panel's loudest redundancy.
 * So each tier says one thing: header = connection, rows = people, meter =
 * signal.
 */
function sessionStatus(
  status: VoiceStatus,
  peopleInCall: number,
): StatusInfo {
  switch (status) {
    case 'connecting':
      return { tone: 'pending', label: 'Joining' };
    case 'test-connecting':
      return { tone: 'pending', label: 'Starting test' };
    case 'testing':
      return { tone: 'active', label: 'Mic test' };
    case 'joined':
      return {
        tone: 'active',
        label: peopleInCall === 1 ? 'Just you' : `${peopleInCall} in call`,
      };
    default:
      return { tone: 'idle', label: 'Not connected' };
  }
}

let cachedCallPeers: VoiceCallPeer[] = [];

function selectCallPeers({ peers }: { peers: PeerPresence[] }): VoiceCallPeer[] {
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

export const VoiceControls = memo(function VoiceControls({
  identity,
  showLabel = false,
  toolbarItem = false,
}: VoiceControlsProps) {
  const noiseCancellationId = useId();
  const gateThresholdLabelId = useId();
  const gateThresholdHintId = useId();
  const [open, setOpen] = useState(false);
  const status = useVoiceStore((state) => state.status);
  const muted = useVoiceStore((state) => state.muted);
  const speaking = useVoiceStore((state) => state.speaking);
  const gateThresholdDb = useVoiceStore((state) => state.gateThresholdDb);
  const noiseCancellation = useVoiceStore((state) => state.noiseCancellation);
  const error = useVoiceStore((state) => state.error);
  const peerStatuses = useVoiceStore((state) => state.peerStatuses);
  const previousFeedbackState = useRef({ status, muted, error });
  const callPeers = usePresenceStore(selectCallPeers);
  const hasFailedPeers = [...peerStatuses.values()].some(
    (peerStatus) => peerStatus === 'failed',
  );
  const engaged = status === 'joined' || status === 'testing';
  const session = sessionStatus(status, callPeers.length + 1);
  // The trigger is the only voice affordance visible with the panel closed, so
  // its label stays about your microphone rather than about the session.
  const triggerLabel =
    status === 'idle'
      ? 'Voice chat'
      : status === 'joined'
        ? `Voice chat: ${participantStatus(muted, speaking).label}`
        : `Voice chat: ${session.label}`;

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
        if (
          !nextOpen &&
          (status === 'test-connecting' || status === 'testing')
        ) {
          stopVoiceTest();
        }
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
            {status === 'connecting' || status === 'test-connecting' ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : status === 'testing' ? (
              <AudioLines aria-hidden="true" />
            ) : status === 'joined' && muted ? (
              <MicOff aria-hidden="true" className="text-danger" />
            ) : status === 'joined' && speaking ? (
              // No pulse: the icon swap already says "live", and a throbbing
              // control in permanent chrome is the opposite of calm.
              <AudioLines aria-hidden="true" />
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
          'w-[min(20rem,calc(100vw-2rem))] gap-6 p-4',
        )}
      >
        {/*
          One status readout, fixed in the header, for every state. The body
          below then only ever holds controls, so switching state swaps a
          button row rather than reflowing the whole panel.
        */}
        <PopoverHeader className="flex-row items-center justify-between gap-3">
          <PopoverTitle>Voice chat</PopoverTitle>
          <span
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-center gap-2 text-xs"
          >
            <StatusDot tone={session.tone} />
            <span className={STATUS_TEXT[session.tone]}>{session.label}</span>
          </span>
        </PopoverHeader>

        {/*
          With no rules to divide them, the tiers are held apart by gap alone:
          24px between them, 12px inside this one, 16px inside the settings
          block. The steps have to stay clearly unequal or the panel flattens
          back into one undifferentiated list.
        */}
        <div className="flex flex-col gap-3">
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

          {status === 'connecting' || status === 'test-connecting' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9"
              onClick={status === 'connecting' ? leaveVoice : stopVoiceTest}
            >
              {status === 'connecting' ? 'Cancel' : 'Cancel test'}
            </Button>
          ) : status === 'joined' ? (
            <div className="flex items-center gap-2.5">
              <Toggle
                pressed={!muted}
                onPressedChange={() => setMuted(!muted)}
                variant="outline"
                size="sm"
                className={cn(
                  'h-9 flex-1',
                  muted && 'border-danger-border bg-danger-bg text-danger',
                )}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {muted ? (
                  <MicOff aria-hidden="true" data-icon="inline-start" />
                ) : (
                  <Mic aria-hidden="true" data-icon="inline-start" />
                )}
                {muted ? 'Unmute' : 'Mute'}
              </Toggle>
              {/* Leaving a call is routine and reversible, so it stays neutral.
                  Red in this panel means "muted" and nothing else. */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9"
                onClick={leaveVoice}
              >
                <PhoneOff aria-hidden="true" data-icon="inline-start" />
                Leave
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {/* "Join muted" states the behaviour instead of describing it in
                  a sentence above the button. */}
              <Button
                type="button"
                size="sm"
                className="h-9"
                onClick={() => void joinVoice()}
              >
                <Mic aria-hidden="true" data-icon="inline-start" />
                {error ? 'Try again' : 'Join muted'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9"
                onClick={
                  status === 'testing'
                    ? stopVoiceTest
                    : () => void startVoiceTest()
                }
              >
                <AudioLines aria-hidden="true" data-icon="inline-start" />
                {status === 'testing' ? 'Stop test' : 'Test mic'}
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">

          <SettingRow
            label="Noise cancellation"
            hint="Filters steady background hum"
            htmlFor={noiseCancellationId}
            trailing={
              <Switch
                id={noiseCancellationId}
                checked={noiseCancellation}
                onCheckedChange={setNoiseCancellation}
              />
            }
          />

          <SettingRow
            label="Voice activation"
            hint="Your mic opens above this level"
            labelId={gateThresholdLabelId}
            hintId={gateThresholdHintId}
            trailing={
              <output className="shrink-0 font-mono text-xs tabular-nums text-fg-muted">
                {formatDb(gateThresholdDb)}
              </output>
            }
          >
            {/*
              Meter and slider share one axis: the slider uses edge thumb
              alignment, so the thumb sits exactly under the point on the meter
              where the gate opens. The filled slider track is the blocked
              range — sound passes when the bar above overruns it.
            */}
            <div className="flex flex-col gap-2">
              <VoiceInputMeter />
              <Slider
                aria-labelledby={gateThresholdLabelId}
                aria-describedby={gateThresholdHintId}
                min={MIN_VOICE_LEVEL_DB}
                max={MAX_VOICE_LEVEL_DB}
                step={1}
                value={gateThresholdDb}
                onValueChange={(nextValue) =>
                  setGateThreshold(
                    Array.isArray(nextValue) ? nextValue[0]! : nextValue,
                  )
                }
              />
            </div>
          </SettingRow>
        </div>
      </PopoverContent>
    </Popover>
  );
});

/**
 * Typographic minus, and a thin space before the unit — a mono space between
 * number and unit is nearly a full character wide and pulls the two apart.
 */
function formatDb(db: number) {
  return `${db.toString().replace('-', '−')} dB`;
}

/**
 * Fixed-size so a tone change never nudges the label beside it, including the
 * swap to the spinner.
 */
function StatusDot({ tone }: { tone: StatusTone }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-3 shrink-0 items-center justify-center"
    >
      {tone === 'pending' ? (
        <LoaderCircle className="size-3 animate-spin text-fg-muted motion-reduce:animate-none" />
      ) : (
        <span className={cn('size-1.5 rounded-full', STATUS_DOT[tone])} />
      )}
    </span>
  );
}

/** Both device settings use this one row, so they cannot drift apart. */
function SettingRow({
  label,
  hint,
  labelId,
  hintId,
  htmlFor,
  trailing,
  children,
}: {
  label: string;
  hint: string;
  labelId?: string;
  hintId?: string;
  htmlFor?: string;
  trailing: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <span className="flex min-w-0 flex-col gap-1">
          <label
            id={labelId}
            htmlFor={htmlFor}
            className="text-sm font-medium text-fg"
          >
            {label}
          </label>
          <span id={hintId} className="text-xs text-fg-muted">
            {hint}
          </span>
        </span>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function VoiceInputMeter() {
  const inputLevelDb = useVoiceStore((state) => state.inputLevelDb);
  const speaking = useVoiceStore((state) => state.speaking);
  const inputLevelPercent = voiceLevelPercent(inputLevelDb);

  return (
    <div
      role="meter"
      aria-label="Microphone input level"
      aria-valuemin={MIN_VOICE_LEVEL_DB}
      aria-valuemax={MAX_VOICE_LEVEL_DB}
      aria-valuenow={Math.round(inputLevelDb)}
      aria-valuetext={`${Math.round(inputLevelDb)} decibels, ${
        speaking ? 'voice active' : 'gate closed'
      }`}
      className="h-1.5 overflow-hidden rounded-full bg-panel"
    >
      <span
        aria-hidden="true"
        className={cn(
          'block h-full transition-[width] duration-75 motion-reduce:transition-none',
          speaking ? 'bg-fg' : 'bg-border-strong',
        )}
        style={{ width: `${inputLevelPercent}%` }}
      />
    </div>
  );
}

function VoiceParticipant({
  name,
  color,
  muted,
  speaking,
  connectionStatus,
}: {
  name: string;
  color: string;
  muted: boolean;
  speaking: boolean;
  connectionStatus?: VoicePeerStatus;
}) {
  const { tone, label } = participantStatus(muted, speaking, connectionStatus);
  return (
    <li className="flex h-9 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold ring-1 ring-border"
        style={{ backgroundColor: color, color: textOnColor(color) }}
      >
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-fg">{name}</span>
      {/*
        Fixed width, not shrink-to-fit: the labels differ in length, so a
        right-aligned group scatters the dots across ~60px and the list stops
        reading as a column. 104px = the 12px dot, the 8px gap, and the longest
        label ("Reconnecting", 78px at 12px Inter) with room for a fallback face.
      */}
      <span className="flex w-26 shrink-0 items-center gap-2 text-xs">
        <StatusDot tone={tone} />
        <span className={cn('truncate', STATUS_TEXT[tone])}>{label}</span>
      </span>
    </li>
  );
}
