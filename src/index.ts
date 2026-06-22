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

// ---------------------------------------------------------------------------
// Capability-descriptor parser
// ---------------------------------------------------------------------------
// Parse a capability descriptor `.md` (frontmatter + optional body) into a
// CapabilityDescriptor — the *data* half of a capability: its outcome and its
// edges. The *code* half (the `run` executor) stays in capabilities.ts,
// keyed by type; the two are joined when the engine resolves a capability.
//
// Hand-parsed, no YAML dependency — matching the skill-descriptor convention
// above. The frontmatter is flat: `type` and `postcondition` are scalars,
// `composes`, `nextSteps`, and `grants` are inline lists. Unrecognised fields
// are deliberately ignored, so the format is forward-compatible. The body is
// reserved for per-capability guidance and is unused at v0.
//
// Example descriptor:
//
//   ---
//   type: define-what-product-means
//   postcondition: you will have a working, shared definition of what …
//   composes: [discover-product-need]
//   nextSteps: [classify-product-organisation]
//   ---
//   <optional guidance body…>

export class CapabilityParseError extends Error {}

/** Human-in-the-loop level for running a capability's executor:
 *  - `none` — just run (reversible / read-only: naming, reads, analysis).
 *  - `proposes` — run and surface the result for review (still reversible).
 *  - `assent` — require explicit human assent before firing (the live-touching
 *    few: apply / destroy / cutover / deploy), surfaced conversationally.
 * Absent in the descriptor → `none`. The capability-level replacement for the
 * blanket "OK, do it" gate. */
export type CapabilityGate = 'none' | 'proposes' | 'assent';

/** How a capability runs (the "executed three ways" of the Capabilities ADR):
 *  - `native` — a deterministic code executor (EXECUTORS), e.g. provisioning.
 *  - `inline` — the body is an LLM prompt the host runs.
 *  - `compose` — an objective-tree composition (its work is its `composes`).
 * Absent → undefined; the engine infers from composes/EXECUTORS as it does
 * today (legacy descriptors don't declare it). */
export type CapabilityExecution = 'native' | 'inline' | 'compose';

/** One typed input of a capability that compiles to a conversation tool.
 * Same shape as a skill input (`- name: type (required) — description`). */
export interface CapabilityInput {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

/** The data half of a capability descriptor, loaded from the corpus. The
 * `run` executor is held separately in capabilities.ts and joined by type. */
export interface CapabilityDescriptor {
  /** The objective type this capability handles; matches the filename stem. */
  type: string;
  /** Outcome postcondition — "you will have …". */
  postcondition: string;
  /** Capabilities whose outcomes this one builds on (composition edges). */
  composes: string[];
  /** Candidate follow-on capabilities (forward edges). */
  nextSteps: string[];
  /** Human-in-the-loop level for running the executor. Default `none`. */
  gate: CapabilityGate;
  /** Tool permissions the executor may use beyond the read-only floor — least
   * permission. Empty (the default) means read-only; a token like `write`
   * grants exactly what's listed and nothing more (STDIO-392). */
  grants: string[];
  /** Tool display name (when the capability compiles to a conversation tool). */
  name?: string;
  /** Tool description — what the model sees when choosing it. */
  description?: string;
  /** How the capability runs. Absent for legacy objective-tree descriptors. */
  execution?: CapabilityExecution;
  /** The deterministic verifier the execution runs as a HARD postcondition — a
   * named check (e.g. `design-pack`) the runtime resolves and runs against what
   * the model produced, looping the model on its findings until it passes. A
   * prose `postcondition` is a hope; this is enforced. Absent means the
   * capability has no mechanically-checkable postcondition (judgement-shaped
   * output). */
  verify?: string;
  /** Typed inputs — present when the capability is a conversation tool. */
  inputs: CapabilityInput[];
  /** What the capability produces (free text). Optional. */
  output?: string;
  /** Reserved body — per-capability guidance, or (for `inline`) the prompt.
   * Empty when the descriptor has no body. */
  guidance: string;
}

const CAPABILITY_REQUIRED_KEYS = ['type', 'postcondition'] as const;

// splitFrontmatter for capabilities — same logic as the skill version above
// but throws CapabilityParseError instead of SkillParseError.
function splitCapabilityFrontmatter(raw: string): { frontmatter: string[]; body: string } {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new CapabilityParseError("descriptor must begin with a '---' fence");
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    throw new CapabilityParseError("descriptor frontmatter has no closing '---'");
  }
  return {
    frontmatter: lines.slice(1, end),
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
  };
}

// An inline list value: `[a, b, c]` → ['a','b','c']; a bare scalar → a
// single-element list. Empty `[]` or empty scalar → [].
function inlineList(value: string): string[] {
  const v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => unquote(s.trim()))
      .filter(Boolean);
  }
  const scalar = unquote(v);
  return scalar ? [scalar] : [];
}

/** Parse one capability input line — `- name: type (required) — description` —
 * into a CapabilityInput. Returns null for a malformed line (skipped, not
 * fatal). Type is a free string (not narrowed to the SkillInputType union). */
function parseCapabilityInput(line: string): CapabilityInput | null {
  const t = line.trim().replace(/^-\s*/, '');
  const colon = t.indexOf(':');
  if (colon === -1) return null;
  const name = t.slice(0, colon).trim();
  if (!name) return null;
  const rest = t.slice(colon + 1).trim();
  const required = /\(required\)/i.test(rest);
  const type = rest.split(/\s+/)[0] || 'string';
  const dash = rest.indexOf('—');
  const description = dash !== -1 ? rest.slice(dash + 1).trim() : '';
  return { name, type, required, description };
}

/** Parse a capability descriptor `.md` (frontmatter + optional body) into a
 * CapabilityDescriptor. Hand-parsed, no YAML dependency. `idHint` is the
 * filename stem; the descriptor's `type` must match it. */
export function parseCapability(idHint: string, raw: string): CapabilityDescriptor {
  const { frontmatter, body } = splitCapabilityFrontmatter(raw);

  const scalars: Record<string, string> = {};
  let composes: string[] = [];
  let nextSteps: string[] = [];
  let grants: string[] = [];
  const inputs: CapabilityInput[] = [];

  for (let i = 0; i < frontmatter.length; i++) {
    const line = frontmatter[i];
    if (!line.trim()) continue;
    // Indented lines are block continuations (e.g. input entries); they're
    // consumed by their block key below, never treated as top-level scalars.
    if (/^\s/.test(line)) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1);

    if (key === 'composes') {
      composes = inlineList(value);
      continue;
    }
    if (key === 'nextSteps') {
      nextSteps = inlineList(value);
      continue;
    }
    if (key === 'grants') {
      grants = inlineList(value);
      continue;
    }
    if (key === 'inputs') {
      // Block form: subsequent indented `- name: type (required) — desc` lines.
      for (let j = i + 1; j < frontmatter.length && /^\s+-\s/.test(frontmatter[j]); j++) {
        const parsed = parseCapabilityInput(frontmatter[j]);
        if (parsed) inputs.push(parsed);
      }
      continue;
    }
    // Any other key is kept as a scalar (surfaced only if a field below reads
    // it). Unrecognised descriptor fields are deliberately ignored, so a new
    // field — `grants` now, `tier`/`portability` later — never breaks an older
    // parser.
    scalars[key] = unquote(value.trim());
  }

  for (const k of CAPABILITY_REQUIRED_KEYS) {
    if (!scalars[k]) {
      throw new CapabilityParseError(`descriptor missing required field: ${k}`);
    }
  }

  const type = scalars.type;
  if (type !== idHint) {
    throw new CapabilityParseError(
      `capability type '${type}' does not match filename '${idHint}' — rename one to match`
    );
  }

  const gate: CapabilityGate =
    scalars.gate === 'proposes' || scalars.gate === 'assent' ? scalars.gate : 'none';

  const execution: CapabilityExecution | undefined =
    scalars.execution === 'native' ||
    scalars.execution === 'inline' ||
    scalars.execution === 'compose'
      ? scalars.execution
      : undefined;

  return {
    type,
    postcondition: scalars.postcondition,
    composes,
    nextSteps,
    grants,
    gate,
    name: scalars.name || undefined,
    description: scalars.description || undefined,
    execution,
    inputs,
    output: scalars.output || undefined,
    verify: scalars.verify || undefined,
    guidance: body,
  };
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
