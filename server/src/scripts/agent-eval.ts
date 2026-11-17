/**
 * Saved instructions for "Ask the board", run against the real model, so a
 * prompt or tool change can be checked before it ships. Spends real credit
 * (~$0.01 a case).
 *
 *   cd server && NODE_USE_ENV_PROXY=1 node --env-file=.env --import tsx src/scripts/agent-eval.ts [filter]
 *
 * `NODE_USE_ENV_PROXY` because plain Node fetch ignores a sandbox proxy. The
 * model is the env default for the agent job, or `AGENT_EVAL_MODEL`.
 */
import type { AgentAction, AgentBoardSummary } from '@whiteboard/shared';
import { env } from '../env';
import {
  AGENT_TOOLS,
  LOOK_TOOL,
  agentMessages,
  parseAgentActions,
  sayOf,
  type AgentContext,
} from '../ai/agent';
import { chatCompletion } from '../ai/openrouter';

interface Answer {
  actions: AgentAction[];
  reply?: string;
  look: boolean;
}

interface Case {
  name: string;
  instruction: string;
  board?: Partial<AgentBoardSummary>;
  context?: AgentContext;
  /** Null when the answer is right, else what is wrong with it. */
  check: (answer: Answer) => string | null;
}

const VIEW = { x: 0, y: 0, w: 1200, h: 700 };
const types = (a: Answer) => a.actions.map((x) => x.type);
const has = (type: AgentAction['type']) => (a: Answer) =>
  types(a).includes(type) ? null : `expected ${type}, got [${types(a).join(', ')}]`;
const only = (...allowed: AgentAction['type'][]) => (a: Answer) =>
  a.actions.length && a.actions.every((x) => allowed.includes(x.type))
    ? null
    : `expected only ${allowed.join('/')}, got [${types(a).join(', ')}]`;
const answers = (a: Answer) =>
  a.reply && !a.actions.length && !a.look ? null : `expected a text answer, got [${types(a).join(', ')}]`;
/** Written for the answer card: maths in LaTeX, no greeting, no closing question. */
const formatted = (a: Answer) => {
  const text = a.reply ?? '';
  const prose = text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, '');
  if (!/\$/.test(text)) return 'no LaTeX at all';
  if (/[²³⁴⁻¹]|_\{|\^|\\[a-z]+/.test(prose)) return `maths outside $…$: ${JSON.stringify(prose.slice(0, 120))}`;
  if (/^\s*(hi|hello|sure|great)\b/i.test(text)) return 'opens with a greeting';
  if (/\?\s*$/.test(text)) return 'ends with a question';
  return null;
};
const all =
  (...checks: ((a: Answer) => string | null)[]) =>
  (a: Answer) =>
    checks.map((c) => c(a)).find(Boolean) ?? null;
const inView = (a: Answer) => {
  for (const x of a.actions) {
    if (!('x' in x) || x.x === undefined || !('y' in x) || x.y === undefined) continue;
    if (x.x < VIEW.x || x.y < VIEW.y || x.x > VIEW.x + VIEW.w || x.y > VIEW.y + VIEW.h) {
      return `${x.type} placed outside the view at (${x.x}, ${x.y})`;
    }
  }
  return null;
};

const graph = { id: 'g1', type: 'graph', x: 100, y: 100, w: 420, h: 280, expressions: ['y = x^2'] };
const eq1 = { id: 'e1', type: 'equation', x: 600, y: 120, w: 200, h: 48, content: 'x^2 - 5x + 6 = 0' };
const eq2 = { id: 'e2', type: 'equation', x: 640, y: 220, w: 180, h: 48, content: '(x-2)(x-3) = 0' };
const eq3 = { id: 'e3', type: 'equation', x: 610, y: 320, w: 120, h: 48, content: 'x = 2, 3' };
const ink = { id: 'd1', type: 'draw', x: 100, y: 450, w: 300, h: 60 };

const CASES: Case[] = [
  { name: 'plot', instruction: 'plot y = sin x', check: all(only('create_graph'), inView) },
  {
    name: 'points stay separate',
    instruction: 'plot the points (1,2), (3,4) and (5,1)',
    check: (a) => {
      const g = a.actions.find((x) => x.type === 'create_graph');
      return g && g.type === 'create_graph' && g.expressions.length >= 3 ? null : 'expected 3 point rows';
    },
  },
  { name: 'equation', instruction: 'write the quadratic formula', check: all(only('create_equation'), inView) },
  { name: 'question', instruction: 'what is the derivative of x^3?', check: all(answers, formatted) },
  {
    name: 'answer with working',
    instruction: 'why is \\log_{ab} b = -2 when \\log_{ab} a = 3?',
    check: all(
      answers,
      formatted,
      (a) => (a.reply?.includes('$$') ? null : 'working not on its own line'),
      // The claim is true; an answer that opens by denying it then proves it.
      (a) => (/^\W*(it isn't|it is not|this doesn't|that's not|the claim|that claim|this is false)/i.test(a.reply ?? '') ? 'opens by disputing a true claim' : null),
    ),
  },
  {
    name: 'explain and draw',
    instruction: 'explain what a parabola is and draw one',
    check: (a) => has('create_graph')(a) ?? (a.reply ? formatted(a) : 'expected say beside the graph'),
  },
  {
    name: 'edit selection',
    instruction: 'make this red',
    board: { selection: ['g1'], shapes: [graph] },
    check: only('update_shape'),
  },
  {
    name: 'add to a graph',
    instruction: 'add y = 2x + 1 to the graph',
    board: { shapes: [graph] },
    check: (a) => {
      const u = a.actions.find((x) => x.type === 'update_shape');
      return u && u.type === 'update_shape' && u.expressions?.includes('y = x^2') ? null : 'expected the old expression kept';
    },
  },
  {
    name: 'align',
    instruction: 'line up the equations on the left',
    board: { shapes: [eq1, eq2, eq3] },
    check: only('align_shapes'),
  },
  {
    name: 'frame',
    instruction: 'put the equations in a frame called Solution',
    board: { shapes: [eq1, eq2, eq3] },
    check: has('create_frame'),
  },
  {
    name: 'group',
    instruction: 'group the three equations',
    board: { shapes: [eq1, eq2, eq3] },
    check: only('group_shapes'),
  },
  {
    name: 'hatch',
    instruction: 'give the selected rectangle a hatched fill',
    board: { selection: ['r1'], shapes: [{ id: 'r1', type: 'rectangle', x: 100, y: 100, w: 200, h: 100 }] },
    check: (a) => {
      const u = a.actions.find((x) => x.type === 'update_shape');
      return u && u.type === 'update_shape' && u.fillStyle === 'hatch' ? null : 'expected fillStyle hatch';
    },
  },
  {
    name: 'handwriting asks to look',
    instruction: 'is my working right?',
    board: { shapes: [ink] },
    check: (a) => (a.look ? null : 'expected look_at_board'),
  },
  {
    name: 'leaves the rest alone',
    instruction: 'delete the graph',
    board: { shapes: [graph, eq1] },
    check: (a) => {
      const d = a.actions.find((x) => x.type === 'delete_shapes');
      return d && d.type === 'delete_shapes' && d.ids.join() === 'g1' ? null : 'expected only g1 deleted';
    },
  },
  {
    name: 'follow-up',
    instruction: 'now make it blue',
    board: { selection: ['g1'], shapes: [graph] },
    context: { previous: [{ instruction: 'plot y = x^2', answer: 'Added a graph' }] },
    check: only('update_shape'),
  },
  {
    name: 'hints only',
    instruction: 'solve x^2 - 5x + 6 = 0 for me',
    context: { hints: true },
    check: (a) =>
      /x\s*=\s*2\b.*\b3\b|x\s*=\s*3\b.*\b2\b/s.test(`${a.reply ?? ''} ${JSON.stringify(a.actions)}`)
        ? 'gave the roots away'
        : null,
  },
];

async function run(c: Case): Promise<Answer> {
  const board: AgentBoardSummary = { viewport: VIEW, selection: [], shapes: [], omitted: 0, ...c.board };
  const { content, toolCalls } = await chatCompletion(
    process.env.AGENT_EVAL_MODEL ?? env.openRouterAgentModel,
    agentMessages(c.instruction, board, c.context),
    AGENT_TOOLS,
  );
  const actions = parseAgentActions(toolCalls);
  return {
    actions,
    look: toolCalls.some((t) => t.name === LOOK_TOOL),
    reply: sayOf(toolCalls, 4000) ?? (actions.length ? undefined : content.trim() || undefined),
  };
}

const filter = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
const cases = CASES.filter((c) => !filter || c.name.includes(filter));
const results = await Promise.all(
  cases.map(async (c) => {
    try {
      const answer = await run(c);
      return { c, answer, problem: c.check(answer) };
    } catch (error) {
      return { c, problem: `request failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }),
);
// `-v` prints every written answer, to read how they come out.
if (process.argv.includes('-v')) {
  for (const r of results) if ('answer' in r && r.answer?.reply) console.log(`--- ${r.c.name}\n${r.answer.reply}\n`);
}
for (const { c, problem } of results) console.log(`${problem ? 'FAIL' : 'ok  '}  ${c.name}${problem ? ` — ${problem}` : ''}`);
const failed = results.filter((r) => r.problem).length;
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exitCode = failed ? 1 : 0;
