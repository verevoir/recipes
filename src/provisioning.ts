// PRACTICE PROVISIONING — stage 2 of the capability pipeline. Given a request
// (and the capabilities retrieved for it), it provisions the *practice* set
// that governs the work: a foundational always-on floor ∪ the practices homed
// under the concerns that genuinely apply.
//
// THE MECHANISM (validated, not invented here). The eval at
// eval/practice-nav/run-tags.ts proved — 93% recall, clean — that the right way
// to reach practices is NOT embedding. Practices sit at a conceptual tier the
// sentence-embedder can't bridge (a "flaky CI suite" request shares no surface
// vocabulary with "test-determinism"), so the embedder used for capabilities
// (slice 1) is deliberately NOT used here. Instead a *reasoning* model tags the
// work against a fixed ~10-concern MENU (ids + one-line descriptors only, never
// the practice list), and `concern → practice-ids` resolves the bucket
// deterministically. A foundational set covers the universal code-hygiene
// practices that apply to essentially all code work and are never "selected".
// This module ports run-tags.ts to production.
//
// ─────────────────────────────────────────────────────────────────────────────
// INTERIM CONFIG — READ THIS.
//
// CONCERN_MENU, CONCERN_PRACTICES and FOUNDATIONAL below are an INTERIM,
// hand-maintained copy of the concern taxonomy. The single source of truth for
// which practices live under which concern MUST become the corpus itself — the
// practice `.md` files carry their concern tag (folder placement and/or
// frontmatter), and this config is then *read* from the corpus rather than
// duplicated here. Until aigency-guardrails is tagged, this table stands in for
// that read. When you tag the corpus: delete these three constants, load the
// concern→practice map from the corpus, and keep only the model-call + union
// logic. Do not let this table drift into a second source of truth.
// ─────────────────────────────────────────────────────────────────────────────

import { chat as anthropicChat } from '@verevoir/llm/anthropic';
import type { ChatOptions, ChatReply, ModelClass } from '@verevoir/llm';
import type { CapabilityDescriptor } from './index.js';

/** The model-call surface the reasoning steps use. Defaults to the Anthropic
 * adapter, but any provider's `chat` (from `@verevoir/llm`) can be injected so
 * concern-tagging runs on DeepSeek / Mistral / etc. without recipes importing
 * every provider SDK (STDIO-340). */
export type ChatFn = (opts: ChatOptions) => Promise<ChatReply>;

/** One concern the reasoning model classifies the work against: an id plus the
 * one-line "is this your area?" descriptor. The model sees ONLY this menu — no
 * practice names — so tag-selection happens at the concern tier and practices
 * resolve deterministically afterwards. */
export interface Concern {
  id: string;
  descriptor: string;
}

/**
 * INTERIM. The ~10-concern menu (ported from eval/practice-nav/taxonomy.ts
 * CONCERNS — ids + descriptors only). See the interim banner at the top of the
 * file: this belongs in the corpus.
 */
export const CONCERN_MENU: Concern[] = [
  {
    id: 'architecture-and-docs',
    descriptor:
      'How the system is structured and whether that structure and its decisions are written down and stay current — boundaries, ADRs, agent/onboarding context, deferring commitments.',
  },
  {
    id: 'apis-and-contracts',
    descriptor:
      'The shape of interfaces a caller depends on: stable contracts, machine-readable schemas, consistent representations, stable identifiers, and how the same entity reads in and out.',
  },
  {
    id: 'errors-and-resilience',
    descriptor:
      'Behaving correctly when things fail or run at once: retry-safe and atomic operations, legible failures, concurrency and async correctness, validating untrusted input.',
  },
  {
    id: 'security',
    descriptor:
      'Keeping the system safe from abuse: threat modelling, secret handling, validating untrusted input, vulnerability scanning, and supply-chain integrity.',
  },
  {
    id: 'delivery-and-deploy',
    descriptor:
      'Getting a build safely into production and back out: infrastructure as code, drift detection, gradual deploy, rollback, schema migration safety, post-deploy smoke gating.',
  },
  {
    id: 'observability',
    descriptor:
      'Seeing what the running system is doing: traces/metrics/logs, structured logging, and capturing production errors as actionable, aggregated data.',
  },
  {
    id: 'change-and-review',
    descriptor:
      'How a change is made legible and judged: pull-request structure, commit/change traceability, pre-commit gates, static analysis.',
  },
  {
    id: 'dependencies-and-build',
    descriptor:
      'Managing third-party code and the build: keeping dependencies current, reproducible builds, supply-chain integrity, scanning for known vulnerabilities.',
  },
  {
    id: 'testing',
    descriptor:
      'Whether behaviour is genuinely verified: automated tests, the test pyramid, testing through the public interface, integration against real dependencies, determinism, coverage honesty, tests-as-spec, regression tests from escaped defects.',
  },
  {
    id: 'performance-and-ux',
    descriptor:
      'What the end user experiences: accessibility of the interface and the size/weight of what gets shipped to the client.',
  },
];

/**
 * INTERIM. concern id → real practice ids homed under it (ported from
 * eval/practice-nav/taxonomy.ts CONCERNS). The `find_practices` map. See the
 * interim banner: this belongs in the corpus.
 */
export const CONCERN_PRACTICES: Record<string, string[]> = {
  'architecture-and-docs': [
    'architecture-boundaries',
    'architecture-documented',
    'agent-context-file-maintained',
    'deliberate-deferral',
    'local-dev-onboarding',
    'user-journeys-documented',
    'solutions-meet-platform-standards',
  ],
  'apis-and-contracts': [
    'api-contract-stability',
    'declarative-contract',
    'contract-symmetry',
    'addressability',
    'input-validation',
  ],
  'errors-and-resilience': [
    'atomicity-and-idempotency',
    'failure-legibility',
    'concurrency',
    'input-validation',
  ],
  security: [
    'threat-modelling',
    'secret-handling',
    'input-validation',
    'vulnerability-scanning',
    'supply-chain-integrity',
  ],
  'delivery-and-deploy': [
    'infrastructure-as-code',
    'iac-drift-detection',
    'deploy-safety',
    'rollback-readiness',
    'schema-migration-safety',
    'journey-smoke-coverage',
    'build-reproducibility',
  ],
  observability: ['observability', 'structured-logging', 'error-tracking'],
  'change-and-review': [
    'pull-request-structure',
    'change-traceability',
    'pre-commit-gates',
    'static-analysis',
  ],
  'dependencies-and-build': [
    'dependency-currency',
    'build-reproducibility',
    'supply-chain-integrity',
    'vulnerability-scanning',
  ],
  testing: [
    'automated-testing',
    'test-pyramid',
    'test-through-the-public-interface',
    'integration-tested-against-real-dependencies',
    'test-determinism',
    'coverage-honesty',
    'cover-deliberate-behaviour',
    'tests-read-as-specification',
    'one-reason-to-fail',
    'escaped-defects-become-regression-tests',
  ],
  'performance-and-ux': ['accessibility', 'bundle-size-discipline'],
};

/**
 * INTERIM. The always-on foundational practices — provisioned for essentially
 * all code work, never "selected". Testing discipline + boundary
 * input-validation + failure-legibility + error-tracking are the universal code
 * hygiene the corpus treats as table-stakes (mirrors FOUNDATIONAL in
 * eval/practice-nav/run-tags.ts). See the interim banner: this belongs in the
 * corpus.
 */
export const FOUNDATIONAL: string[] = [
  'automated-testing',
  'test-pyramid',
  'test-determinism',
  'coverage-honesty',
  'test-through-the-public-interface',
  'tests-read-as-specification',
  'one-reason-to-fail',
  'cover-deliberate-behaviour',
  'escaped-defects-become-regression-tests',
  'integration-tested-against-real-dependencies',
  'input-validation',
  'failure-legibility',
  'error-tracking',
  'comments-earn-their-keep',
  'track-only-intended-files',
];

/** The system prompt for the concern-tagging call — ported verbatim from
 * eval/practice-nav/run-tags.ts (the validated wording). */
const TAG_SYSTEM_PROMPT = `You are an engineering reviewer. You are given a software task and a fixed MENU of engineering CONCERNS (areas of quality), each with a one-line descriptor. Your job is to tag the task with the concerns that genuinely apply to it.

Rules:
- Pick every concern the task plausibly touches, but only those a careful engineer would actually pull for THIS task — do not select a concern just because it could conceivably relate. Selecting all of them is wrong.
- A universal foundation of testing and basic input/error hygiene is ALREADY provisioned for every task; you do NOT need to select concerns merely to cover ordinary unit testing or routine validation. Select a concern only when the task's substance lands in that area.
- Use the concern ids exactly as written in the menu.

Reply with ONLY the selected concern ids, one per line, each prefixed with "- ". No commentary.`;

/** Render the concern menu the model classifies against — ids + descriptors
 * only, never the practice list. */
function concernMenuText(): string {
  return CONCERN_MENU.map((c) => `- ${c.id}: ${c.descriptor}`).join('\n');
}

/**
 * Parse selected concern ids out of the model's reply. Word-boundary anchored
 * so a hyphenated id (`apis-and-contracts`) doesn't also fire its single-word
 * substrings, AND so a single-word id (`security`, `testing`, `observability`)
 * is matched on its own — run-tags.ts had a parser bug here, so the boundary is
 * `[a-z-]` on both sides (not whitespace), letting bare single-word ids match.
 */
export function parseConcernTags(text: string): string[] {
  const found: string[] = [];
  for (const c of CONCERN_MENU) {
    const re = new RegExp(`(?<![a-z-])${c.id}(?![a-z-])`);
    if (re.test(text) && !found.includes(c.id)) found.push(c.id);
  }
  return found;
}

/**
 * Resolve a set of concern tags to a deduped union of their practice ids.
 * Unknown tags contribute nothing (they're skipped, not an error) — a stray tag
 * from a future corpus shouldn't break provisioning.
 */
export function findPractices(tags: string[]): string[] {
  const set = new Set<string>();
  for (const tag of tags) {
    for (const pid of CONCERN_PRACTICES[tag] ?? []) set.add(pid);
  }
  return [...set];
}

/**
 * Ask the reasoning model which concerns apply to the request prose. Returns
 * the selected concern ids (a subset of CONCERN_MENU ids). The caller passes
 * the API key directly — no project-aware key resolution here.
 */
export async function selectConcernTags(
  prose: string,
  apiKey: string | null,
  modelClass: ModelClass = 'reasoning',
  chat: ChatFn = anthropicChat
): Promise<string[]> {
  const res = await chat({
    systemPrompt: TAG_SYSTEM_PROMPT,
    turns: [
      {
        role: 'user',
        content:
          `TASK:\n${prose}\n\n` +
          `CONCERN MENU:\n${concernMenuText()}\n\n` +
          `Select the concern ids that apply.`,
      },
    ],
    modelClass,
    apiKey,
  });

  return parseConcernTags(res.content);
}

/** A request, the concerns chosen for it, and the provisioned practice ids. */
export interface ProvisionInput {
  /** The work described in plain prose — what the model classifies. */
  prose: string;
  /** Concern tags already declared (e.g. read off a corpus-tagged capability).
   * When present, the model call is SKIPPED and these are used directly. */
  declaredTags?: string[];
}

/**
 * Provision the practice bucket for a piece of work: the dedup-union of the
 * FOUNDATIONAL floor and the practices homed under the applicable concerns.
 *
 * Concerns come from `declaredTags` when supplied (no LLM call), otherwise from
 * a reasoning-model classification of the prose. Returns practice IDS only —
 * bodies are loaded at execution time (slice 4), not here.
 */
export async function provisionPractices(
  input: ProvisionInput,
  apiKey: string | null,
  modelClass: ModelClass = 'reasoning',
  chat: ChatFn = anthropicChat
): Promise<string[]> {
  const tags =
    input.declaredTags ?? (await selectConcernTags(input.prose, apiKey, modelClass, chat));
  const set = new Set<string>(FOUNDATIONAL);
  for (const pid of findPractices(tags)) set.add(pid);
  return [...set];
}

/**
 * A capability descriptor MAY one day declare its concern tags directly (so the
 * corpus, not a guess, drives the practices a capability pulls). That field is
 * absent from CapabilityDescriptor today — this reads it defensively so the
 * wire is in place the moment the corpus is tagged. Until then it returns
 * undefined and provisioning falls through to the model guess.
 */
export function declaredConcernsOf(cap: CapabilityDescriptor | undefined): string[] | undefined {
  const concerns = (cap as { concerns?: unknown } | undefined)?.concerns;
  return Array.isArray(concerns) && concerns.every((c) => typeof c === 'string')
    ? (concerns as string[])
    : undefined;
}
