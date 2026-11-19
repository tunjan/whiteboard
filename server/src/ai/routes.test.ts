import { describe, expect, it, vi } from 'vitest';
import {
  MAX_AGENT_INSTRUCTION_CHARS,
  MAX_AUDIO_CHARS,
  MAX_INK_IMAGE_CHARS,
  MAX_LATEX_PROMPT_CHARS,
  MAX_STICKER_PROMPT_CHARS,
  type AiModelsResponse,
  type CheckResponse,
} from '@whiteboard/shared';
import { aiRoutes } from './routes';
import {
  UpstreamError,
  chatCompletion,
  generateImage,
  listModels,
  streamChatCompletion,
  transcribe,
} from './openrouter';
import { recordUsage, setModel } from './models';
import { agentHelpFor } from '../boards/access';

// Board access has its own suite (boards/routes.test.ts); here every request
// is one a board editor sent.
vi.mock('../boards/access', () => ({
  requireBoardEdit: async (_c: unknown, next: () => Promise<void>) => next(),
  agentHelpFor: vi.fn(async () => 'full'),
}));

// The feature gate has its own suite (boards/features.test.ts); here every
// board offers everything.
vi.mock('../boards/features', async () => {
  const { ALL_FEATURES } = await import('@whiteboard/shared');
  return {
    requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next(),
    featuresFor: vi.fn(async () => ALL_FEATURES),
  };
});

// Only the dictation suite gives these answers; every other case is rejected
// before a model is reached.
vi.mock('../auth/middleware', () => ({
  requireTutor: async (_c: unknown, next: () => Promise<void>) => next(),
}));

// Who asked is told to the tutor and stored; not this suite's concern.
vi.mock('./agent-asks', () => ({ recordAgentAsk: vi.fn(async () => {}) }));

vi.mock('./openrouter', async (actual) => ({
  ...(await actual<typeof import('./openrouter')>()),
  transcribe: vi.fn(),
  chatCompletion: vi.fn(),
  streamChatCompletion: vi.fn(),
  generateImage: vi.fn(),
  listModels: vi.fn(),
}));

// The model choice and the usage log are the database's; `fits` stays real.
vi.mock('./models', async (actual) => ({
  ...(await actual<typeof import('./models')>()),
  modelFor: vi.fn(async (job: string) => `test/${job}`),
  selectedModels: vi.fn(async () => ({})),
  recordUsage: vi.fn(),
  setModel: vi.fn(),
}));

/**
 * Request validation only — every case here is rejected before a model is
 * reached, so the suite never spends credit and never depends on whether the
 * machine running it has a key configured.
 */

// `async` rather than a bare return: `Hono.request` is typed
// `Response | Promise<Response>`, and awaiting is what collapses the union.
async function post(path: string, body: unknown, method = 'POST'): Promise<Response> {
  return aiRoutes.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-board-id': 'board-1' },
    body: JSON.stringify(body),
  });
}

describe('POST /latex/ink', () => {
  it('rejects a missing image', async () => {
    expect((await post('/latex/ink', {})).status).toBe(400);
  });

  it('rejects a body that is not JSON', async () => {
    const res = await aiRoutes.request('/latex/ink', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  // Only PNG data URLs: anything else is either a format the raster path never
  // produces, or a `http(s)` URL that would make the server fetch a caller's
  // address on their behalf.
  it.each([
    'https://example.com/a.png',
    'data:image/svg+xml;base64,AAAA',
    'data:text/html;base64,AAAA',
  ])('rejects %s', async (image) => {
    expect((await post('/latex/ink', { image })).status).toBe(400);
  });

  it('rejects an oversized image', async () => {
    const image = `data:image/png;base64,${'A'.repeat(MAX_INK_IMAGE_CHARS)}`;
    expect((await post('/latex/ink', { image })).status).toBe(413);
  });

  // The declared length is checked before the body is read, so an honest
  // header short-circuits the upload rather than buffering it to reject it.
  it('rejects an oversized declared body without reading it', async () => {
    const res = await aiRoutes.request('/latex/ink', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(MAX_INK_IMAGE_CHARS * 2),
      },
      body: JSON.stringify({ image: 'data:image/png;base64,AAAA' }),
    });
    expect(res.status).toBe(413);
  });
});

describe('POST /latex/prompt', () => {
  it.each([{}, { prompt: '' }, { prompt: '   ' }, { prompt: 42 }])(
    'rejects %j',
    async (body) => {
      expect((await post('/latex/prompt', body)).status).toBe(400);
    },
  );

  it('rejects a description past the length cap', async () => {
    const prompt = 'x'.repeat(MAX_LATEX_PROMPT_CHARS + 1);
    expect((await post('/latex/prompt', { prompt })).status).toBe(400);
  });
});

describe('POST /transcribe', () => {
  it.each([{}, { audio: 'AAAA' }, { audio: 'AAAA', format: 'wav' }, { audio: '', format: 'webm' }])(
    'rejects %j',
    async (body) => {
      expect((await post('/transcribe', body)).status).toBe(400);
    },
  );

  it('rejects an oversized clip', async () => {
    const audio = 'A'.repeat(MAX_AUDIO_CHARS + 1);
    expect((await post('/transcribe', { audio, format: 'webm' })).status).toBe(413);
  });
});

describe('POST /transcribe, one round trip', () => {
  it('returns the transcript with its LaTeX', async () => {
    vi.mocked(transcribe).mockResolvedValueOnce({ text: 'x squared', cost: 0.001 });
    vi.mocked(chatCompletion).mockResolvedValueOnce({ content: '$x^2$', cost: 0.0002, toolCalls: [] });
    const res = await post('/transcribe', { audio: 'AAAA', format: 'webm' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'x squared', latex: 'x^2' });
    // Both calls are billed to the board the request came from.
    expect(vi.mocked(recordUsage).mock.calls.slice(-2)).toEqual([
      ['board-1', 'stt', 'test/stt', 0.001],
      ['board-1', 'text', 'test/text', 0.0002],
    ]);
  });

  // What was heard is kept even when it can't be written as maths.
  it('keeps the transcript when no maths is found', async () => {
    vi.mocked(transcribe).mockResolvedValueOnce({ text: 'hello there', cost: 0 });
    vi.mocked(chatCompletion).mockResolvedValueOnce({ content: 'UNREADABLE', cost: 0, toolCalls: [] });
    const res = await post('/transcribe', { audio: 'AAAA', format: 'webm' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: 'hello there',
      error: 'No mathematics found',
    });
  });
});

describe('POST /sticker', () => {
  it('rejects a missing description', async () => {
    expect((await post('/sticker', {})).status).toBe(400);
  });

  it('rejects an overlong description', async () => {
    const prompt = 'a'.repeat(MAX_STICKER_PROMPT_CHARS + 1);
    expect((await post('/sticker', { prompt })).status).toBe(400);
  });

  it('returns the generated image', async () => {
    vi.mocked(generateImage).mockResolvedValueOnce({
      image: 'data:image/png;base64,AAAA',
      cost: 0.007,
    });
    const res = await post('/sticker', { prompt: '  a happy cat ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ image: 'data:image/png;base64,AAAA' });
    expect(vi.mocked(generateImage).mock.calls[0]?.[1]).toContain('of a happy cat.');
  });
});

describe('/models', () => {
  const catalogue = [
    { id: 'a/vision', name: 'Vision', pricing: {}, input: ['text', 'image'], output: ['text'], tools: false },
    { id: 'a/text', name: 'Text', pricing: {}, input: ['text'], output: ['text'], tools: false },
    { id: 'a/stt', name: 'STT', pricing: {}, input: ['audio'], output: ['transcription'], tools: false },
    { id: 'a/img', name: 'Img', pricing: {}, input: ['text'], output: ['image'], tools: false },
    { id: 'a/agent', name: 'Agent', pricing: {}, input: ['text', 'image'], output: ['text'], tools: true },
  ];

  it('offers each job only the models that fit it', async () => {
    vi.mocked(listModels).mockResolvedValueOnce(catalogue);
    const res = await aiRoutes.request('/models');
    expect(res.status).toBe(200);
    const body = (await res.json()) as AiModelsResponse;
    expect(body.options.vision.map((m) => m.id)).toEqual(['a/agent', 'a/vision']);
    expect(body.options.stt.map((m) => m.id)).toEqual(['a/stt']);
    expect(body.options.image.map((m) => m.id)).toEqual(['a/img']);
    expect(body.options.agent.map((m) => m.id)).toEqual(['a/agent']);
  });

  it('refuses a model that cannot do the job', async () => {
    vi.mocked(listModels).mockResolvedValueOnce(catalogue);
    const res = await post('/models', { job: 'vision', model: 'a/text' }, 'PUT');
    expect(res.status).toBe(400);
    expect(setModel).not.toHaveBeenCalled();
  });

  it('saves a model that can', async () => {
    vi.mocked(listModels).mockResolvedValueOnce(catalogue);
    const res = await post('/models', { job: 'stt', model: 'a/stt' }, 'PUT');
    expect(res.status).toBe(200);
    expect(setModel).toHaveBeenCalledWith('stt', 'a/stt');
  });
});

describe('POST /agent', () => {
  const board = { viewport: { x: 0, y: 0, w: 800, h: 600 }, selection: [], shapes: [], omitted: 0 };

  it.each([
    {},
    { text: 'add a graph' },
    { board },
    { board, text: '   ' },
    { board, audio: 'AAAA', format: 'wav' },
  ])('rejects %j', async (body) => {
    expect((await post('/agent', body)).status).toBe(400);
  });

  it('rejects an overlong instruction', async () => {
    const text = 'a'.repeat(MAX_AGENT_INSTRUCTION_CHARS + 1);
    expect((await post('/agent', { board, text })).status).toBe(400);
  });

  it('turns tool calls into validated actions and bills the board', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: 'Done.',
      cost: 0.01,
      toolCalls: [
        { name: 'create_graph', arguments: '{"expressions":["y = x^2"]}' },
        { name: 'launch_rockets', arguments: '{}' },
      ],
    });
    const res = await post('/agent', { board, text: 'plot x squared' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      actions: [{ type: 'create_graph', expressions: ['y = x^2'] }],
    });
    expect(vi.mocked(chatCompletion).mock.calls.at(-1)?.[2]).toBeDefined();
    expect(vi.mocked(recordUsage).mock.calls.at(-1)).toEqual([
      'board-1',
      'agent',
      'test/agent',
      0.01,
    ]);
  });

  it('passes the model\'s text on only when it did nothing', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: 'Which graph do you mean?',
      cost: 0,
      toolCalls: [],
    });
    const res = await post('/agent', { board, text: 'zoom the graph' });
    expect(await res.json()).toEqual({ reply: 'Which graph do you mean?', actions: [] });
  });

  it('asks for a picture when the model wants to look, whatever else it called', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: '',
      cost: 0,
      toolCalls: [
        { name: 'look_at_board', arguments: '{}' },
        { name: 'delete_shapes', arguments: '{"ids":["s1"]}' },
      ],
    });
    const res = await post('/agent', { board, text: 'what does my working say?' });
    expect(await res.json()).toEqual({ look: true, actions: [] });
  });

  it('answers with the picture, without offering the look again', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: 'Line 2 drops a minus sign: it should be $-2x$.',
      cost: 0,
      toolCalls: [],
    });
    const image = 'data:image/png;base64,AAAA';
    const res = await post('/agent', { board, text: 'is this right?', image });
    expect(await res.json()).toEqual({
      reply: 'Line 2 drops a minus sign: it should be $-2x$.',
      actions: [],
    });
    const [, messages, tools] = vi.mocked(chatCompletion).mock.calls.at(-1)!;
    expect(messages.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text' }],
    });
    expect(tools?.map((t) => t.function.name)).not.toContain('look_at_board');
  });

  it.each([
    { image: 'data:image/jpeg;base64,AAAA', text: 'hi' },
    { image: 42, text: 'hi' },
  ])('rejects a bad picture %j', async (fields) => {
    expect((await post('/agent', { board, ...fields })).status).toBe(400);
  });

  it('shows what the model said beside its edits', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: 'The graph goes at x 40.',
      cost: 0,
      toolCalls: [
        { name: 'create_graph', arguments: '{"expressions":["y = x^2"]}' },
        { name: 'say', arguments: '{"text":"A parabola opens upward."}' },
      ],
    });
    const res = await post('/agent', { board, text: 'explain parabolas with a graph' });
    expect(await res.json()).toEqual({
      reply: 'A parabola opens upward.',
      actions: [{ type: 'create_graph', expressions: ['y = x^2'] }],
    });
  });

  it('tells the model the last few exchanges, oldest first', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({ content: 'Because…', cost: 0, toolCalls: [] });
    await post('/agent', {
      board,
      text: 'why?',
      previous: [
        { instruction: 'too old', answer: 'Dropped.' },
        { instruction: 'is 9 prime?', answer: 'No.' },
        { instruction: 'not an exchange' },
        { instruction: 'is 11 prime?', answer: 'Yes.' },
        { instruction: 'is 7 prime?', answer: 'Yes.' },
      ],
    });
    const prompt = vi.mocked(chatCompletion).mock.calls.at(-1)?.[1].at(-1)?.content as string;
    expect(prompt).not.toContain('too old');
    expect(prompt).not.toContain('not an exchange');
    expect(prompt.indexOf('User: is 11 prime?')).toBeLessThan(prompt.indexOf('User: is 7 prime?'));
    expect(prompt).toContain('Result: Yes.');
    expect(prompt.indexOf('Earlier exchanges')).toBeLessThan(prompt.indexOf('Instruction: why?'));
  });

  it('takes a picture sent up front with a spoken instruction', async () => {
    vi.mocked(transcribe).mockResolvedValueOnce({ text: 'what did I write', cost: 0 });
    vi.mocked(chatCompletion).mockResolvedValueOnce({ content: '$x^2$', cost: 0, toolCalls: [] });
    const image = 'data:image/png;base64,AAAA';
    const res = await post('/agent', { board, audio: 'AAAA', format: 'webm', image });
    expect(await res.json()).toEqual({ transcript: 'what did I write', reply: '$x^2$', actions: [] });
    const [, messages] = vi.mocked(chatCompletion).mock.calls.at(-1)!;
    expect(messages.at(-1)).toMatchObject({ content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text' }] });
  });

  it('adds the hints rule when the tutor chose hints', async () => {
    vi.mocked(agentHelpFor).mockResolvedValueOnce('hints');
    vi.mocked(chatCompletion).mockResolvedValueOnce({ content: 'Try factoring.', cost: 0, toolCalls: [] });
    await post('/agent', { board, text: 'solve x^2 - 1 = 0' });
    const system = vi.mocked(chatCompletion).mock.calls.at(-1)?.[1][0]?.content as string;
    expect(system).toContain('hints only');
  });

  it('refuses when the tutor turned it off for students', async () => {
    vi.mocked(agentHelpFor).mockResolvedValueOnce('off');
    const calls = vi.mocked(chatCompletion).mock.calls.length;
    expect((await post('/agent', { board, text: 'plot y = x' })).status).toBe(403);
    expect(vi.mocked(chatCompletion).mock.calls.length).toBe(calls);
  });

  it('streams each step, then the result', async () => {
    vi.mocked(transcribe).mockResolvedValueOnce({ text: 'plot it', cost: 0 });
    vi.mocked(streamChatCompletion).mockImplementationOnce(async (_m, _msgs, _tools, onProgress) => {
      onProgress({ type: 'started' });
      onProgress({ type: 'tool', name: 'create_graph' });
      return { content: '', cost: 0, toolCalls: [{ name: 'create_graph', arguments: '{"expressions":["y = x"]}' }] };
    });
    const res = await post('/agent', { board, audio: 'AAAA', format: 'webm', stream: true });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = (await res.text())
      .split('\n\n')
      .filter((block) => block.startsWith('data:'))
      .map((block) => JSON.parse(block.slice(5)));
    expect(events).toEqual([
      { progress: { step: 'heard', transcript: 'plot it' } },
      { progress: { step: 'thinking' } },
      { progress: { step: 'tool', name: 'create_graph' } },
      { result: { transcript: 'plot it', actions: [{ type: 'create_graph', expressions: ['y = x'] }] } },
    ]);
  });

  it('streams the answer as it is written, and takes back planning text', async () => {
    vi.mocked(streamChatCompletion).mockImplementationOnce(async (_m, _msgs, _tools, onProgress) => {
      onProgress({ type: 'text', delta: 'The graph ' });
      onProgress({ type: 'text', delta: 'goes at x 40.' });
      onProgress({ type: 'tool', name: 'create_graph' });
      onProgress({ type: 'text', delta: 'More planning.' });
      onProgress({ type: 'tool', name: 'say' });
      onProgress({ type: 'args', name: 'say', arguments: '{"text": "A $\\\\frac' });
      onProgress({ type: 'args', name: 'say', arguments: '{"text": "A $\\\\frac{1}{2}$ slope."}' });
      return {
        content: 'The graph goes at x 40.More planning.',
        cost: 0,
        toolCalls: [
          { name: 'create_graph', arguments: '{"expressions":["y = x/2"]}' },
          { name: 'say', arguments: '{"text": "A $\\\\frac{1}{2}$ slope."}' },
        ],
      };
    });
    const res = await post('/agent', { board, text: 'plot a gentle line', stream: true });
    const drafts = (await res.text())
      .split('\n\n')
      .filter((block) => block.startsWith('data:'))
      .map((block) => JSON.parse(block.slice(5)))
      .flatMap((event) => (event.progress?.step === 'draft' ? [event.progress] : []));
    expect(drafts).toEqual([
      { step: 'draft', text: 'The graph ' },
      { step: 'draft', text: 'goes at x 40.' },
      { step: 'draft', text: '', reset: true },
      { step: 'draft', text: 'A $\\frac' },
      { step: 'draft', text: '{1}{2}$ slope.' },
    ]);
  });

  it('ends a stream with the error when the model fails', async () => {
    vi.mocked(streamChatCompletion).mockRejectedValueOnce(new UpstreamError('The model took too long to answer'));
    const res = await post('/agent', { board, text: 'plot y = x', stream: true });
    expect(await res.text()).toContain('{"error":"The model took too long to answer","status":502}');
  });

  it('transcribes a spoken instruction first', async () => {
    vi.mocked(transcribe).mockResolvedValueOnce({ text: 'delete it', cost: 0 });
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: '',
      cost: 0,
      toolCalls: [{ name: 'delete_shapes', arguments: '{"ids":["s1"]}' }],
    });
    const res = await post('/agent', { board, audio: 'AAAA', format: 'webm' });
    expect(await res.json()).toEqual({
      transcript: 'delete it',
      actions: [{ type: 'delete_shapes', ids: ['s1'] }],
    });
    const prompt = vi.mocked(chatCompletion).mock.calls.at(-1)?.[1].at(-1)?.content;
    expect(prompt).toContain('Instruction: delete it');
  });
});

describe('POST /check', () => {
  const image = 'data:image/png;base64,AAAA';
  const reply = (content: string, cost = 0.001) => ({ content, cost, toolCalls: [] });
  const two =
    '{"errors":[{"line":1,"message":"Sign."},{"line":2,"message":"$3^2$ is $9$."}]}';

  it('confirms the mistakes when asked, keeping only those upheld, and bills both calls', async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce(reply(two))
      .mockResolvedValueOnce(reply('{"confirmed":[2]}', 0.002));
    const res = await post('/check', {
      image,
      confirm: true,
      sources: [{ line: 2, kind: 'latex', source: '3^2 = 6' }, { line: 'x' }],
    });
    expect(await res.json()).toEqual({ errors: [{ line: 2, message: '$3^2$ is $9$.' }] });
    const [first, second] = vi.mocked(chatCompletion).mock.calls.slice(-2);
    expect(JSON.stringify(first![1])).toContain('Line 2 (LaTeX): 3^2 = 6');
    expect(JSON.stringify(second![1])).toContain('Claim 2, line 2');
    expect(vi.mocked(recordUsage).mock.calls.slice(-2)).toEqual([
      ['board-1', 'check', 'test/check', 0.001],
      ['board-1', 'check', 'test/check', 0.002],
    ]);
  });

  it('falls back to the first reply when the confirmation is unusable', async () => {
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce(reply(two))
      .mockResolvedValueOnce(reply('They all look right to me.'));
    const res = await post('/check', { image, confirm: true });
    expect(((await res.json()) as CheckResponse).errors).toHaveLength(2);
  });

  it('makes one call without confirm, or on a clean reply', async () => {
    vi.mocked(chatCompletion).mockClear();
    vi.mocked(chatCompletion).mockResolvedValueOnce(reply(two));
    expect(((await (await post('/check', { image })).json()) as CheckResponse).errors).toHaveLength(2);
    vi.mocked(chatCompletion).mockResolvedValueOnce(reply('{"errors":[]}'));
    expect(await (await post('/check', { image, confirm: true })).json()).toEqual({ errors: [] });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });
});
