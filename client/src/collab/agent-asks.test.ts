import { describe, expect, it, vi } from 'vitest';
import { AGENT_ASK_PREFIX } from '@whiteboard/shared';

const add = vi.fn();
vi.mock('@/components/ui/toast', () => ({ toast: { add: (o: unknown) => add(o) } }));

const { askToast, startAgentAskToasts } = await import('./agent-asks');

describe('agent ask toasts', () => {
  it('says who asked what, and what came of it', () => {
    const t = askToast({
      name: 'Lucía',
      color: '#099268',
      at: 0,
      instruction: 'Why is it negative?',
      kind: 'reply',
      result: 'Because **$b^2 - 4ac$** is $-8$.',
    });
    expect(t.title).toBe('Lucía asked the board');
    expect(t.description).toBe('“Why is it negative?” · Answered: Because b^2 - 4ac is -8.');
    expect(t.id).toBe('agent-ask:Lucía');
  });

  it('toasts only its own messages, and stops', () => {
    let listener: ((e: { payload: string }) => void) | undefined;
    const provider = { on: vi.fn((_e, l) => (listener = l)), off: vi.fn() };
    const stop = startAgentAskToasts(provider);
    listener!({ payload: 'whiteboard:latency:1' });
    listener!({ payload: `${AGENT_ASK_PREFIX}not json` });
    expect(add).not.toHaveBeenCalled();
    listener!({
      payload: `${AGENT_ASK_PREFIX}${JSON.stringify({ name: 'Sam', color: null, at: 0, instruction: 'graph it', kind: 'done', result: 'Added a graph' })}`,
    });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ description: '“graph it” · Added a graph' }));
    stop();
    expect(provider.off).toHaveBeenCalled();
  });
});
