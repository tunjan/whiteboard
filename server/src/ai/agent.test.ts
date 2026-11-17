import { describe, expect, it } from 'vitest';
import { MAX_AGENT_ACTIONS, MAX_AGENT_GENERATED_STICKERS } from '@whiteboard/shared';
import { parseAgentActions, partialSayText } from './agent';

const call = (name: string, args: unknown) => ({ name, arguments: JSON.stringify(args) });

describe('parseAgentActions', () => {
  it('keeps a well-formed call, without the keys it left out', () => {
    expect(parseAgentActions([call('create_text', { text: 'Hi', color: 'red' })])).toEqual([
      { type: 'create_text', text: 'Hi', color: 'red' },
    ]);
  });

  it('drops unknown tools, bad JSON and missing required fields', () => {
    expect(
      parseAgentActions([
        call('rm_rf', {}),
        { name: 'create_text', arguments: '{not json' },
        call('create_equation', {}),
        call('create_shape', { kind: 'rectangle', w: 10 }),
        call('create_sticker', { sticker: 'unicorn' }),
      ]),
    ).toEqual([]);
  });

  it('clamps numbers and ignores unknown colours', () => {
    const [action] = parseAgentActions([
      call('create_shape', { kind: 'star', w: 1e9, h: -5, x: Infinity, color: 'chartreuse' }),
    ]);
    expect(action).toEqual({ type: 'create_shape', kind: 'star', w: 5000, h: 4 });
  });

  it('accepts arrow ends as points or shapes', () => {
    expect(
      parseAgentActions([call('create_arrow', { from: { shapeId: 'a' }, to: { x: 1, y: 2 } })]),
    ).toEqual([{ type: 'create_arrow', from: { shapeId: 'a' }, to: { x: 1, y: 2 } }]);
  });

  it('rejects an inverted graph viewport but keeps the graph', () => {
    expect(
      parseAgentActions([
        call('create_graph', {
          expressions: ['y = x', 42],
          viewport: { xMin: 5, xMax: -5, yMin: 0, yMax: 1 },
        }),
      ]),
    ).toEqual([{ type: 'create_graph', expressions: ['y = x'] }]);
  });

  it('splits a bracketed point list into one expression per point', () => {
    expect(
      parseAgentActions([
        call('create_graph', { expressions: ['[(9, 12), (11, 9), (sin(1), 2)]', 'y = x'] }),
      ]),
    ).toEqual([
      { type: 'create_graph', expressions: ['(9, 12)', '(11, 9)', '(sin(1), 2)', 'y = x'] },
    ]);
  });

  it('caps the number of actions', () => {
    const calls = Array.from({ length: MAX_AGENT_ACTIONS + 10 }, () =>
      call('delete_shapes', { ids: ['x'] }),
    );
    expect(parseAgentActions(calls)).toHaveLength(MAX_AGENT_ACTIONS);
  });

  it('caps generated stickers, not the rest of the answer', () => {
    const calls = [
      ...Array.from({ length: MAX_AGENT_GENERATED_STICKERS + 2 }, (_, i) =>
        call('generate_sticker', { prompt: `cat ${i}` }),
      ),
      call('create_text', { text: 'Cats' }),
      call('generate_sticker', { prompt: '' }),
    ];
    const actions = parseAgentActions(calls);
    expect(actions.filter((a) => a.type === 'generate_sticker')).toHaveLength(
      MAX_AGENT_GENERATED_STICKERS,
    );
    expect(actions.at(-1)).toEqual({ type: 'create_text', text: 'Cats' });
  });
  it('parses frames, alignment and groups', () => {
    const calls = [
      { name: 'create_frame', arguments: '{"name":"Part a","ids":["s1","s2"]}' },
      { name: 'align_shapes', arguments: '{"ids":["s1","s2"],"align":"left"}' },
      { name: 'align_shapes', arguments: '{"ids":["s1"],"align":"left"}' },
      { name: 'align_shapes', arguments: '{"ids":["s1","s2"],"align":"diagonal"}' },
      { name: 'group_shapes', arguments: '{"ids":["s1","s2"]}' },
      { name: 'update_shape', arguments: '{"id":"s1","fillStyle":"hatch"}' },
    ];
    expect(parseAgentActions(calls)).toEqual([
      { type: 'create_frame', name: 'Part a', ids: ['s1', 's2'] },
      { type: 'align_shapes', ids: ['s1', 's2'], align: 'left' },
      { type: 'group_shapes', ids: ['s1', 's2'] },
      { type: 'update_shape', id: 's1', fillStyle: 'hatch' },
    ]);
  });

  it('never turns say into an action', () => {
    expect(parseAgentActions([{ name: 'say', arguments: '{"text":"hi"}' }])).toEqual([]);
  });
});

describe('partialSayText', () => {
  it("reads a say call's text while its arguments are still arriving", () => {
    const full = JSON.stringify({ text: 'Use $\\frac{a}{b}$ and "quotes"\n\u00e9' });
    let last = '';
    for (let end = 0; end <= full.length; end++) {
      const read = partialSayText(full.slice(0, end));
      // Each read extends the one before: nothing shown is taken back.
      expect(read.startsWith(last)).toBe(true);
      last = read;
    }
    expect(last).toBe('Use $\\frac{a}{b}$ and "quotes"\n\u00e9');
  });

  it('reads nothing from arguments that are not a text', () => {
    expect(partialSayText('{"other": "x"}')).toBe('');
  });
});
