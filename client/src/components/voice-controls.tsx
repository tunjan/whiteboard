import { memo, useId, useState } from 'react';
import {
  AudioLines,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
} from 'lucide-react';
import type { Identity } from '@/collab/identity';
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
  useVoiceStore,
} from '@/collab/voice/use-voice-store';
import {
  type PeerPresence,
  type VoicePresence,
  usePresenceStore,
} from '@/collab/use-presence-store';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Toggle, toggleVariants } from '@/components/ui/toggle';
import {
  MAX_VOICE_LEVEL_DB,
  MIN_VOICE_LEVEL_DB,
  voiceLevelPercent,
} from '@/collab/voice/voice-gate';
import { cn } from '@/lib/utils';

interface VoiceControlsProps {
  identity: Identity | null;
}

interface VoiceCallPeer {
  clientId: number;
  name: string;
  color: string;
  voice: VoicePresence;
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
}: VoiceControlsProps) {
  const noiseCancellationId = useId();
  const gateThresholdLabelId = useId();
  const gateThresholdDescriptionId = useId();
  const [open, setOpen] = useState(false);
  const status = useVoiceStore((state) => state.status);
  const muted = useVoiceStore((state) => state.muted);
  const speaking = useVoiceStore((state) => state.speaking);
  const gateThresholdDb = useVoiceStore(
    (state) => state.gateThresholdDb,
  );
  const noiseCancellation = useVoiceStore(
    (state) => state.noiseCancellation,
  );
  const error = useVoiceStore((state) => state.error);
  const peerStatuses = useVoiceStore((state) => state.peerStatuses);
  const callPeers = usePresenceStore(selectCallPeers);
  const hasFailedPeers = [...peerStatuses.values()].some(
    (peerStatus) => peerStatus === 'failed',
  );
  const triggerLabel =
    status === 'connecting'
      ? 'Joining voice'
      : status === 'test-connecting'
        ? 'Preparing microphone test'
        : status === 'testing'
          ? speaking
            ? 'Microphone test, voice detected'
            : 'Microphone test running'
      : status === 'joined'
        ? muted
          ? 'Voice joined, microphone muted'
          : speaking
            ? 'Voice joined, speaking'
            : 'Voice joined, listening'
        : 'Voice chat';
  if (!identity) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
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
                aria-label={triggerLabel}
                aria-pressed={status === 'joined' || status === 'testing'}
                className={cn(
                  toggleVariants({ size: 'sm' }),
                  'size-8 p-0',
                  (status === 'joined' || status === 'testing') &&
                    speaking &&
                    'bg-bg-success text-content-success hover:bg-bg-success',
                )}
              />
            }
          >
            {status === 'connecting' || status === 'test-connecting' ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : status === 'testing' ? (
              <AudioLines aria-hidden="true" />
            ) : status === 'joined' && muted ? (
              <MicOff aria-hidden="true" />
            ) : status === 'joined' && speaking ? (
              <AudioLines aria-hidden="true" />
            ) : (
              <Mic aria-hidden="true" />
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom">{triggerLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={10}
        className="w-[min(21rem,calc(100vw-2rem))] gap-3 p-3"
      >
        <PopoverHeader>
          <PopoverTitle>Voice chat</PopoverTitle>
          <PopoverDescription>
            {status === 'joined'
              ? 'Talk with everyone on this board.'
              : status === 'testing' || status === 'test-connecting'
                ? 'Test your microphone without joining the call.'
              : 'Join muted, then turn on your microphone when ready.'}
          </PopoverDescription>
        </PopoverHeader>

        {error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg bg-bg-error px-3 py-2 text-sm text-content-error"
          >
            <span>{error}</span>
            {status === 'joined' && hasFailedPeers ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={retryFailedVoiceConnections}
              >
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}

        {status === 'connecting' || status === 'test-connecting' ? (
          <div className="flex flex-col gap-2">
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded-lg bg-bg-muted px-3 py-2 text-content-subtle"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              {status === 'connecting'
                ? 'Waiting for microphone permission…'
                : 'Preparing microphone test…'}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={
                status === 'connecting' ? leaveVoice : stopVoiceTest
              }
            >
              {status === 'connecting' ? 'Cancel joining' : 'Cancel test'}
            </Button>
          </div>
        ) : status === 'testing' ? (
          <>
            <div className="flex flex-col gap-1.5 rounded-lg bg-bg-muted px-3 py-2.5">
              <div className="flex items-center gap-2 font-medium text-content-emphasis">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2 rounded-full',
                    speaking ? 'bg-content-success' : 'bg-content-muted',
                  )}
                />
                {speaking
                  ? 'Voice detected — gate open'
                  : 'Listening — gate closed'}
              </div>
              <p className="text-xs text-content-subtle">
                Speak normally. Green means your audio passes the current
                threshold. Noise cancellation is{' '}
                {noiseCancellation ? 'on' : 'off'}.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" onClick={() => void joinVoice()}>
                <Mic aria-hidden="true" data-icon="inline-start" />
                Join voice
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={stopVoiceTest}
              >
                Stop test
              </Button>
            </div>
          </>
        ) : status === 'joined' ? (
          <>
            <ul
              aria-label="People in voice chat"
              className="flex max-h-48 flex-col gap-1 overflow-y-auto"
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

            <div className="flex items-center gap-2">
              <Toggle
                pressed={!muted}
                onPressedChange={() => setMuted(!muted)}
                variant="outline"
                className="flex-1"
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {muted ? (
                  <MicOff aria-hidden="true" />
                ) : (
                  <Mic aria-hidden="true" />
                )}
                {muted ? 'Unmute' : 'Mute'}
              </Toggle>
              <Button
                type="button"
                variant="destructive"
                onClick={leaveVoice}
              >
                <PhoneOff aria-hidden="true" data-icon="inline-start" />
                Leave
              </Button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={() => void joinVoice()}>
              <Mic aria-hidden="true" data-icon="inline-start" />
              {error ? 'Try again' : 'Join voice'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void startVoiceTest()}
            >
              <AudioLines aria-hidden="true" data-icon="inline-start" />
              Test microphone
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 rounded-lg bg-bg-muted px-3 py-2.5">
          <label
            htmlFor={noiseCancellationId}
            className="flex min-w-0 flex-col"
          >
            <span className="text-sm font-medium text-content-emphasis">
              Noise Cancellation
            </span>
            <span className="text-xs text-content-subtle">
              Reduce steady background noise
            </span>
          </label>
          <Switch
            id={noiseCancellationId}
            checked={noiseCancellation}
            onCheckedChange={setNoiseCancellation}
          />
        </div>

        <div className="flex flex-col gap-2.5 rounded-lg bg-bg-muted px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span
                id={gateThresholdLabelId}
                className="text-sm font-medium text-content-emphasis"
              >
                Voice Activation
              </span>
              <span
                id={gateThresholdDescriptionId}
                className="text-xs text-content-subtle"
              >
                Raise it to block more background sound
              </span>
            </div>
            <output className="shrink-0 font-mono text-xs tabular-nums text-content-subtle">
              {gateThresholdDb} dB
            </output>
          </div>

          <VoiceInputMeter gateThresholdDb={gateThresholdDb} />

          <Slider
            aria-labelledby={gateThresholdLabelId}
            aria-describedby={gateThresholdDescriptionId}
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
      </PopoverContent>
    </Popover>
  );
});

function VoiceInputMeter({
  gateThresholdDb,
}: {
  gateThresholdDb: number;
}) {
  const inputLevelDb = useVoiceStore((state) => state.inputLevelDb);
  const speaking = useVoiceStore((state) => state.speaking);
  const inputLevelPercent = voiceLevelPercent(inputLevelDb);
  const thresholdPercent = voiceLevelPercent(gateThresholdDb);

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
      className="relative h-2 overflow-hidden rounded-full bg-bg-default ring-1 ring-border-subtle"
    >
      <span
        aria-hidden="true"
        className={cn(
          'block h-full transition-[width,background-color] duration-75 motion-reduce:transition-none',
          speaking ? 'bg-content-success' : 'bg-content-muted',
        )}
        style={{ width: `${inputLevelPercent}%` }}
      />
      <span
        aria-hidden="true"
        className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-content-emphasis"
        style={{ left: `${thresholdPercent}%` }}
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
  const statusLabel =
    connectionStatus === 'failed'
      ? 'Connection failed'
      : connectionStatus === 'disconnected'
        ? 'Reconnecting…'
        : connectionStatus === 'connecting'
          ? 'Connecting…'
          : muted
            ? 'Muted'
            : speaking
              ? 'Speaking'
              : 'Listening';
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5',
        speaking && 'bg-bg-success',
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-1 ring-black/10"
        style={{ backgroundColor: color }}
      >
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {name}
      </span>
      <span className="flex items-center gap-1 text-xs text-content-subtle">
        {muted ? (
          <MicOff aria-hidden="true" className="size-3.5" />
        ) : speaking ? (
          <AudioLines
            aria-hidden="true"
            className="size-3.5 text-content-success"
          />
        ) : (
          <Mic aria-hidden="true" className="size-3.5" />
        )}
        {statusLabel}
      </span>
    </li>
  );
}
