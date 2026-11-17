import { AGENT_ASK_PREFIX, plainAnswer, type AgentAsk } from '@whiteboard/shared';
import { toast } from '@/components/ui/toast';

interface StatelessProvider {
  on: (event: 'stateless', listener: (event: { payload: string }) => void) => unknown;
  off: (event: 'stateless', listener: (event: { payload: string }) => void) => unknown;
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** The toast a tutor gets for one student instruction. */
export function askToast(ask: AgentAsk) {
  const outcome =
    ask.kind === 'done'
      ? ask.result
      : ask.kind === 'reply'
        ? `Answered: ${clip(plainAnswer(ask.result), 90)}`
        : 'Nothing changed';
  return {
    // One per student: a run of instructions updates their toast in place.
    id: `agent-ask:${ask.name}`,
    title: `${ask.name} asked the board`,
    description: `“${clip(ask.instruction, 120)}” · ${outcome}`,
    data: { people: [{ name: ask.name, color: ask.color ?? 'var(--fg-muted)' }] },
  };
}

/**
 * Show the tutor each student instruction to the board agent as it is
 * answered. The server sends these to tutor connections only.
 */
export function startAgentAskToasts(provider: StatelessProvider): () => void {
  const onStateless = ({ payload }: { payload: string }) => {
    if (!payload.startsWith(AGENT_ASK_PREFIX)) return;
    let ask: AgentAsk;
    try {
      ask = JSON.parse(payload.slice(AGENT_ASK_PREFIX.length)) as AgentAsk;
    } catch {
      return;
    }
    toast.add(askToast(ask));
  };
  provider.on('stateless', onStateless);
  return () => provider.off('stateless', onStateless);
}
