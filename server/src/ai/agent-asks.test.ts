import { describe, expect, it, vi } from 'vitest';

vi.mock('../collab/hocuspocus', () => ({ notifyTutors: vi.fn() }));
vi.mock('../db/client', () => ({ db: {} }));

const { askOf, parseAsker } = await import('./agent-asks');

describe('askOf', () => {
  it('reads edits, answers and neither', () => {
    const done = askOf({ name: ' Lucía ', color: '#099268' }, 'plot x^2', {
      actions: [{ type: 'create_graph', expressions: ['x^2'] }],
    }, 5);
    expect(done).toEqual({
      name: 'Lucía',
      color: '#099268',
      at: 5,
      instruction: 'plot x^2',
      kind: 'done',
      result: 'Added a graph',
    });
    expect(askOf(null, 'why?', { actions: [], reply: 'Because.' }).kind).toBe('reply');
    expect(askOf(null, 'hm', { actions: [] })).toMatchObject({ kind: 'nothing', result: '' });
  });

  it('keeps an unverified name to a label', () => {
    expect(parseAsker({ name: 'x'.repeat(100), color: 'red; background:url(x)' })).toEqual({
      name: 'x'.repeat(60),
      color: null,
    });
    expect(parseAsker(undefined).name).toBe('Guest');
  });
});
