// @verevoir/skills — the skill-descriptor format and parser, shared by every
// surface that loads skills: the aigency web app (compiles them to chat-time
// tools) and the MCP server (exposes the reasoning ones as prompts).
//
// A skill is a `.md` file with flat frontmatter + an instruction body. The
// frontmatter is deliberately flat so it parses without a YAML dependency.
// `inputs` is the one structured field — a block list of typed params — which
// maps to a tool's input_schema or a prompt's arguments.
//
// Example descriptor:
//
//   ---
//   id: evaluate_cv
//   name: Evaluate CV
//   description: Score a CV against role criteria.
//   tags: [cv, evaluation]
//   model_class: reasoning
//   inputs:
//     - cv_text: string (required) — the candidate's CV text
//     - criteria: string — the role criteria to score against
//   output: evaluation — per-criterion scores and a recommendation
//   ---
//   <instruction body…>

export class SkillParseError extends Error {}

/** The model tier an inline (LLM) skill runs at. Named semantically on the
 * descriptor (`model_class: reasoning | extraction`); absent → reasoning. */
export type SkillModelClass = 'reasoning' | 'extraction';

export type SkillInputType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface SkillInput {
  /** Argument name. */
  name: string;
  /** Declared type; defaults to `string`. */
  type: SkillInputType;
  /** Whether the argument is required. */
  required: boolean;
  /** Human description. */
  description: string;
}

export interface SkillDescriptor {
  /** Canonical id; matches the descriptor filename stem. */
  id: string;
  /** Human-facing capability name. */
  name: string;
  /** One-line capability summary. */
  description: string;
  /** Discovery tags. */
  tags: string[];
  /** Typed input contract. */
  inputs: SkillInput[];
  /** Standard output: a resource kind label + a description of what the skill
   * produces. */
  output: { kind: string; description: string };
  /** Model tier for inline execution. Absent on the descriptor → reasoning. */
  modelClass: SkillModelClass;
  /** Native handler name. When set, the skill is deterministic code (e.g.
   * `fetch_url`) rather than an LLM prompt. */
  handler?: string;
  /** Optional A2A agent endpoint the executor may delegate to. */
  agentUrl?: string;
  /** The instruction body — the system prompt for inline runs / the prompt a
   * host model executes. */
  instructions: string;
}

const REQUIRED_KEYS = ['id', 'name', 'description'] as const;
const VALID_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'array',
  'object',
]);

interface SplitResult {
  frontmatter: string[];
  body: string;
}

function splitFrontmatter(raw: string): SplitResult {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new SkillParseError("descriptor must begin with a '---' fence");
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    throw new SkillParseError("descriptor frontmatter has no closing '---'");
  }
  return {
    frontmatter: lines.slice(1, end),
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
  };
}

function scalarOrInlineList(value: string): string | string[] {
  const v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => unquote(s.trim()))
      .filter(Boolean);
  }
  return unquote(v);
}

function unquote(value: string): string {
  const wrapped =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return wrapped ? value.slice(1, -1) : value;
}

// Parse one `inputs:` block-list line into a SkillInput. Tolerant of an
// em-dash or a `--`/`-` description separator; defaults type to string.
//   - <name>: <type> (required) — <description>
function parseInputLine(line: string): SkillInput | null {
  const item = line.trim().replace(/^-\s+/, '').trim();
  if (!item) return null;
  const colon = item.indexOf(':');
  if (colon === -1) return null;
  const name = item.slice(0, colon).trim();
  const rest = item.slice(colon + 1).trim();
  if (!name) return null;

  let description = '';
  let meta = rest;
  const dash = rest.search(/\s+(—|--)\s+/);
  if (dash !== -1) {
    meta = rest.slice(0, dash).trim();
    description = rest.replace(/^.*?\s+(—|--)\s+/, '').trim();
  }

  const required = /\(required\)/i.test(meta);
  const typeToken = meta
    .replace(/\(required\)/i, '')
    .trim()
    .split(/\s+/)[0];
  const type: SkillInputType = VALID_TYPES.has(typeToken)
    ? (typeToken as SkillInputType)
    : 'string';

  return { name, type, required, description };
}

function parseOutput(value: string): { kind: string; description: string } {
  const v = value.trim();
  const dash = v.search(/\s+(—|--)\s+/);
  if (dash === -1) {
    return { kind: v || 'result', description: '' };
  }
  return {
    kind: v.slice(0, dash).trim() || 'result',
    description: v.replace(/^.*?\s+(—|--)\s+/, '').trim(),
  };
}

/** Parse a skill descriptor `.md` (frontmatter + instruction body) into a
 * SkillDescriptor. Hand-parsed, no YAML dependency. `idHint` is the filename
 * stem; the descriptor's `id` must match it. */
export function parseSkill(idHint: string, raw: string): SkillDescriptor {
  const { frontmatter, body } = splitFrontmatter(raw);

  const scalars: Record<string, string> = {};
  const tags: string[] = [];
  const inputs: SkillInput[] = [];

  for (let i = 0; i < frontmatter.length; i++) {
    const line = frontmatter[i];
    if (!line.trim()) continue;

    if (line.trim() === 'inputs:') {
      for (let j = i + 1; j < frontmatter.length; j++) {
        const next = frontmatter[j];
        if (!/^\s*-\s+/.test(next)) {
          i = j - 1;
          break;
        }
        const parsed = parseInputLine(next);
        if (parsed) inputs.push(parsed);
        i = j;
      }
      continue;
    }

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1);

    if (key === 'tags') {
      const parsed = scalarOrInlineList(value);
      if (Array.isArray(parsed)) tags.push(...parsed);
      continue;
    }
    const parsed = scalarOrInlineList(value);
    scalars[key] = Array.isArray(parsed) ? parsed.join(', ') : parsed;
  }

  for (const k of REQUIRED_KEYS) {
    if (!scalars[k]) {
      throw new SkillParseError(`descriptor missing required field: ${k}`);
    }
  }

  if (scalars.id !== idHint) {
    throw new SkillParseError(
      `skill id '${scalars.id}' does not match filename '${idHint}' — rename one to match`
    );
  }

  const modelClass: SkillModelClass =
    scalars.model_class?.trim() === 'extraction' ? 'extraction' : 'reasoning';

  return {
    id: scalars.id,
    name: scalars.name,
    description: scalars.description,
    tags,
    inputs,
    output: parseOutput(scalars.output ?? ''),
    modelClass,
    handler: scalars.handler?.trim() || undefined,
    agentUrl: scalars.agent?.trim() || undefined,
    instructions: body,
  };
}

/** Reasoning skills (no native handler) are the ones worth exposing as a
 * prompt or inline-LLM tool; a handler-backed skill is deterministic code a
 * host usually already has. */
export function isReasoningSkill(skill: SkillDescriptor): boolean {
  return !skill.handler;
}

/** Render the prompt body a host model executes: the skill's instructions
 * followed by the supplied argument values. Only non-empty args are included,
 * so optional arguments left blank don't clutter the prompt. */
export function renderSkillPrompt(
  skill: SkillDescriptor,
  args: Record<string, string | undefined>
): string {
  const supplied = skill.inputs
    .map((input) => ({ input, value: args[input.name]?.trim() }))
    .filter((x) => x.value);

  if (supplied.length === 0) return skill.instructions;

  const inputBlock = supplied.map(({ input, value }) => `### ${input.name}\n${value}`).join('\n\n');

  return `${skill.instructions}\n\n---\n\n## Inputs\n\n${inputBlock}`;
}
