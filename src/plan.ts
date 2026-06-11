// CAPABILITY PLAN — stage 3 of the capability pipeline. Turns a request into an
// ordered, dependency-wired plan of capability nodes, each carrying the practice
// bucket (slice 2) that governs it. PURE of side effects: corpus + request in,
// plan out — no enactment, no DB writes, no on-screen objectives. The executor
// (slice 4) drives `enactCapability` over this plan, adds per-capability tier
// routing, and adds the LAZY refinement (re-running the retriever on a node's
// post-enactment prose) that only carries information once a parent has run —
// which is why it lives there, not here.
//
// HOW A PLAN IS BUILT
//  1. Retrieve (slice 1, embedding): the request prose ranks the corpus; the
//     top-K are HIGH-RECALL candidates — deliberately over-inclusive, "the
//     downstream model narrows".
//  2. Narrow (reasoning): a reasoning model picks, from those candidates, the
//     capabilities the request GENUINELY calls for — the entry set. A single
//     line of prose routinely calls for several ("evaluate this contract's
//     risks and write me a board report" → three). This is the capability-side
//     twin of slice 2's concern tagger: high-recall retrieval, reasoning-tier
//     precision. Discrimination is reasoning-tier.
//  3. Close over `composes`: each entry capability builds on the outcomes it
//     `composes` (discover-product-need ← define-what-product-means ← …). We
//     walk those edges, pulling every resolvable prerequisite into the plan.
//     Edges that don't resolve to a known capability are skipped — they name
//     produced artifacts, not sub-capabilities (mirrors capability-tree.ts).
//     `nextSteps` are NOT expanded — forward/optional follow-ons offered later,
//     not planned now (same rule as capability-tree.ts).
//  4. Order: a node depends on its in-plan `composes` entries; a topological
//     sort (alphabetical tie-break, so the plan is deterministic) puts
//     prerequisites before the capabilities that need them.
//  5. Provision (slice 2): the request's concerns are classified ONCE, then each
//     node provisions FOUNDATIONAL ∪ its concern-practices — using the
//     capability's DECLARED concern tags when the corpus carries them (dormant
//     until the corpus is tagged), else the request-level classification.

import { chat } from '@verevoir/llm/anthropic';
import type { ModelClass } from '@verevoir/llm';
import type { CapabilityDescriptor } from './index';
import type { RetrievedCapability } from './retrieval';
import { selectConcernTags, provisionPractices, declaredConcernsOf } from './provisioning';

/** One capability in the plan, with the practices that govern it and the
 * in-plan capabilities it depends on (its resolvable `composes` edges). */
export interface PlanNode {
  capability: string;
  /** Practice ids provisioned for this node (slice 2). */
  practices: string[];
  /** In-plan capability types this one builds on — runs after all of them. */
  dependsOn: string[];
  /** Whether the request addressed this capability directly (`retrieved`) or it
   * was pulled in as a prerequisite (`composed`). */
  source: 'retrieved' | 'composed';
}

export interface ExecutionPlan {
  request: string;
  /** Entry capability types the request directly called for (post-narrowing). */
  entry: string[];
  /** All capabilities to run, in dependency order — prerequisites first. */
  nodes: PlanNode[];
}

/** The capability type of a `composes` edge, with any `@fanKey` suffix
 * stripped (the planner doesn't fan — it plans one node per capability type). */
function edgeType(entry: string): string {
  const at = entry.indexOf('@');
  return at === -1 ? entry : entry.slice(0, at);
}

/** The resolvable `composes` prerequisites of a capability: edge types that
 * name a known capability. Unresolvable edges (produced artifacts like
 * `repository-agent-documentation`) are dropped — same rule as
 * capability-tree.ts. */
function composesOf(type: string, byType: Map<string, CapabilityDescriptor>): string[] {
  const cap = byType.get(type);
  if (!cap) return [];
  const deps: string[] = [];
  for (const e of cap.composes) {
    const t = edgeType(e);
    if (t !== type && byType.has(t) && !deps.includes(t)) deps.push(t);
  }
  return deps;
}

/**
 * PURE. From a set of entry capability types and the corpus, build the ordered
 * plan graph: close over `composes` to pull in every resolvable prerequisite,
 * wire each node's `dependsOn`, and topologically sort so prerequisites come
 * first. Deterministic — ties broken alphabetically. No practices here (that's
 * the IO half in `planExecution`); this is the graph the tests pin down.
 *
 * Unknown entry types (not in the corpus) are ignored. A `composes` cycle
 * (shouldn't occur — the corpus test forbids dangling edges) is broken by
 * appending the unresolved remainder in a stable order rather than looping.
 */
export function buildPlanGraph(
  entryTypes: string[],
  corpus: CapabilityDescriptor[]
): Array<{
  capability: string;
  dependsOn: string[];
  source: 'retrieved' | 'composed';
}> {
  const byType = new Map(corpus.map((c) => [c.type, c]));
  const entry = new Set(entryTypes.filter((t) => byType.has(t)));

  // Closure: walk composes from every entry capability.
  const inPlan = new Set(entry);
  const stack = [...entry];
  while (stack.length > 0) {
    const t = stack.pop()!;
    for (const dep of composesOf(t, byType)) {
      if (!inPlan.has(dep)) {
        inPlan.add(dep);
        stack.push(dep);
      }
    }
  }

  // dependsOn for every node, restricted to what's in the plan.
  const deps = new Map<string, string[]>();
  for (const t of inPlan)
    deps.set(
      t,
      composesOf(t, byType).filter((d) => inPlan.has(d))
    );

  // Kahn topological sort, alphabetical tie-break for determinism.
  const indeg = new Map<string, number>();
  for (const t of inPlan) indeg.set(t, deps.get(t)!.length);
  const dependents = new Map<string, string[]>();
  for (const t of inPlan) {
    for (const d of deps.get(t)!) {
      (dependents.get(d) ?? dependents.set(d, []).get(d)!).push(t);
    }
  }
  const ready = [...inPlan].filter((t) => indeg.get(t) === 0).sort();
  const order: string[] = [];
  const seen = new Set<string>();
  while (ready.length > 0) {
    ready.sort();
    const t = ready.shift()!;
    if (seen.has(t)) continue;
    seen.add(t);
    order.push(t);
    for (const dependent of (dependents.get(t) ?? []).slice().sort()) {
      indeg.set(dependent, (indeg.get(dependent) ?? 0) - 1);
      if (indeg.get(dependent) === 0) ready.push(dependent);
    }
  }
  // Cycle guard: append any unvisited node deterministically rather than drop it.
  for (const t of [...inPlan].sort()) if (!seen.has(t)) order.push(t);

  return order.map((capability) => ({
    capability,
    dependsOn: deps.get(capability)!,
    source: entry.has(capability) ? 'retrieved' : 'composed',
  }));
}

/** System prompt for the entry-capability narrowing call — the capability-side
 * mirror of practice-provisioning's concern tagger. */
export const NARROW_SYSTEM_PROMPT = `You are routing a request to the capabilities that will fulfil it. You are given a request and a CANDIDATE LIST of capabilities, each with an id and what it produces. Your job is to pick the capabilities the request GENUINELY calls for.

Rules:
- A single request often calls for several capabilities — select every one the request actually asks for, in substance.
- Do NOT select a capability merely because it is adjacent or could conceivably relate. If the request does not ask for what a capability produces, leave it out.
- Prerequisites are added automatically downstream — select only the capabilities the request directly asks for, not the steps they depend on.
- Use the capability ids exactly as written in the candidate list.

Reply with ONLY the selected ids, one per line, each prefixed with "- ". No commentary.`;

/** Parse selected ids out of a model reply, matching only against the supplied
 * id set, order preserved by the candidate list. Word-boundary anchored so a
 * hyphenated id doesn't fire its substrings (same rule as parseConcernTags). */
export function parseSelectedIds(text: string, ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const re = new RegExp(`(?<![a-z-])${id}(?![a-z-])`);
    if (re.test(text) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Narrow the high-recall retrieved candidates to the capabilities the request
 * genuinely calls for, with a reasoning-model call. Returns the selected types
 * (a subset of the candidates). The model sees each candidate's id + what it
 * produces (description ?? postcondition) — never the practice or edge detail.
 * The caller passes the API key directly — no project-aware key resolution here.
 */
export async function selectEntryCapabilities(
  request: string,
  candidates: RetrievedCapability[],
  corpus: CapabilityDescriptor[],
  apiKey: string | null,
  modelClass: ModelClass = 'reasoning'
): Promise<string[]> {
  if (candidates.length === 0) return [];
  const byType = new Map(corpus.map((c) => [c.type, c]));
  const ids = candidates.map((c) => c.type).filter((t) => byType.has(t));
  const menu = ids
    .map((t) => {
      const c = byType.get(t)!;
      return `- ${t}: ${c.description ?? c.postcondition ?? ''}`;
    })
    .join('\n');

  const res = await chat({
    systemPrompt: NARROW_SYSTEM_PROMPT,
    turns: [
      {
        role: 'user',
        content:
          `REQUEST:\n${request}\n\n` +
          `CANDIDATE CAPABILITIES:\n${menu}\n\n` +
          `Select the capabilities this request directly calls for.`,
      },
    ],
    modelClass,
    apiKey,
  });

  return parseSelectedIds(res.content, ids);
}

/** Injection seam so `planExecution` is testable without the embedder or any
 * model call — a test supplies fakes; production uses the real retriever +
 * reasoning calls. */
export interface PlanDeps {
  /** REQUIRED — the host builds the index with its embedder and passes this. */
  retrieve: (prose: string) => Promise<RetrievedCapability[]>;
  /** Anthropic API key, passed directly by the caller. */
  apiKey: string | null;
  selectEntry?: (
    request: string,
    candidates: RetrievedCapability[],
    corpus: CapabilityDescriptor[]
  ) => Promise<string[]>;
  classifyConcerns?: (prose: string) => Promise<string[]>;
  /** Top-K candidates to retrieve before narrowing. Defaults to the retriever's
   * high-recall default. */
  k?: number;
  /** Model tier for the coordinator calls (narrow + concern-tag). Defaults to
   * `reasoning` — production never changes it; the slice-5 matrix sweeps it to
   * demonstrate the discrimination floor. Ignored when `selectEntry` /
   * `classifyConcerns` are injected directly. */
  coordinatorTier?: ModelClass;
}

/**
 * Plan the execution of a request: retrieve high-recall candidates, narrow them
 * to the entry capabilities the request genuinely calls for, close over
 * `composes` for prerequisites, order by dependency, and provision a practice
 * bucket per node. Returns the ordered plan — nothing is enacted.
 *
 * The corpus is an explicit parameter — recipes never loads a corpus from disk.
 * The caller supplies `deps.retrieve` (the host-built index over that corpus)
 * and `deps.apiKey`.
 *
 * The request's concerns are classified once and reused for every node that
 * doesn't carry declared concern tags; declared tags (when the corpus has them)
 * specialise a node's practices without a further model call.
 */
export async function planExecution(
  request: string,
  corpus: CapabilityDescriptor[],
  deps: PlanDeps
): Promise<ExecutionPlan> {
  const coordinatorTier = deps.coordinatorTier ?? 'reasoning';
  const retrieve = deps.retrieve;
  const selectEntry =
    deps.selectEntry ??
    ((req, cands, corp) => selectEntryCapabilities(req, cands, corp, deps.apiKey, coordinatorTier));
  const classifyConcerns =
    deps.classifyConcerns ??
    ((prose: string) => selectConcernTags(prose, deps.apiKey, coordinatorTier));

  const byType = new Map(corpus.map((c) => [c.type, c]));

  const candidates = await retrieve(request);
  const entry = await selectEntry(request, candidates, corpus);
  const graph = buildPlanGraph(entry, corpus);

  // Classify the request's concerns once; nodes with declared tags override.
  const requestTags = await classifyConcerns(request);

  const nodes: PlanNode[] = [];
  for (const g of graph) {
    const declared = declaredConcernsOf(byType.get(g.capability));
    const practices = await provisionPractices(
      { prose: request, declaredTags: declared ?? requestTags },
      deps.apiKey,
      coordinatorTier
    );
    nodes.push({
      capability: g.capability,
      practices,
      dependsOn: g.dependsOn,
      source: g.source,
    });
  }

  return {
    request,
    entry: graph.filter((g) => g.source === 'retrieved').map((g) => g.capability),
    nodes,
  };
}
