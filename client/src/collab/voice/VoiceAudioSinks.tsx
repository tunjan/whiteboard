import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { useVoiceStore } from './use-voice-store';

export function VoiceAudioSinks() {
  const remotes = useVoiceStore((state) => state.remotes);
  const audioElements = useRef(new Map<number, HTMLAudioElement>());
  const [blockedPeers, setBlockedPeers] = useState<Set<number>>(
    () => new Set(),
  );
  const markBlocked = useCallback((clientId: number, blocked: boolean) => {
    setBlockedPeers((current) => {
      const next = new Set(current);
      if (blocked) next.add(clientId);
      else next.delete(clientId);
      if (next.size === current.size && [...next].every((id) => current.has(id))) {
        return current;
      }
      return next;
    });
  }, []);
  const registerAudio = useCallback(
    (clientId: number, audio: HTMLAudioElement | null) => {
      if (audio) audioElements.current.set(clientId, audio);
      else audioElements.current.delete(clientId);
    },
    [],
  );

  function enableAudio(): void {
    blockedPeers.forEach((clientId) => {
      const audio = audioElements.current.get(clientId);
      if (!audio) return;
      void audio
        .play()
        .then(() => markBlocked(clientId, false))
        .catch(() => markBlocked(clientId, true));
    });
  }

  return (
    <>
      {[...remotes].map(([clientId, stream]) => (
        <RemoteAudioSink
          key={clientId}
          clientId={clientId}
          stream={stream}
          onBlockedChange={markBlocked}
          onAudioChange={registerAudio}
        />
      ))}
      {blockedPeers.size > 0 ? (
        <Surface
          role="status"
          aria-live="polite"
          className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 -translate-x-1/2 p-1.5"
        >
          <Button
            type="button"
            size="sm"
            onClick={enableAudio}
          >
            <Volume2 aria-hidden="true" data-icon="inline-start" />
            Tap to enable audio
          </Button>
        </Surface>
      ) : null}
    </>
  );
}

function RemoteAudioSink({
  clientId,
  stream,
  onBlockedChange,
  onAudioChange,
}: {
  clientId: number;
  stream: MediaStream;
  onBlockedChange: (clientId: number, blocked: boolean) => void;
  onAudioChange: (
    clientId: number,
    audio: HTMLAudioElement | null,
  ) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let cancelled = false;
    audio.srcObject = stream;
    onAudioChange(clientId, audio);
    void audio
      .play()
      .then(() => {
        if (!cancelled) onBlockedChange(clientId, false);
      })
      .catch(() => {
        if (!cancelled) onBlockedChange(clientId, true);
      });

    return () => {
      cancelled = true;
      audio.pause();
      audio.srcObject = null;
      onAudioChange(clientId, null);
      onBlockedChange(clientId, false);
    };
  }, [clientId, onAudioChange, onBlockedChange, stream]);

  return <audio ref={audioRef} autoPlay playsInline hidden />;
}
