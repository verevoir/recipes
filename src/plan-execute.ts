// PLAN EXECUTION — the PURE, plan-first execution engine, sibling to
// `buildPlanGraph` in plan.ts. Where plan.ts turns a request into a dependency
// DAG of capability nodes, this module GATES that plan (inspect before you
// spend), LAYERS it, and EXECUTES it with independent nodes running CONCURRENTLY.
//
// Everything here is a PURE function of the plan (its `dependsOn` edges) plus
// INJECTED enactment — no LLM, no network, no SDK. A real coordinator wraps
// `enactCapability`; tests pass a mock. That purity is why these live in recipes
// as a shared engine primitive (aigency, the MCP, or anyone can drive them),
// rather than in any one consumer.
//
// `RecordedCall` is the executor's opaque cost-accounting unit — the executor
// threads a node's recorded calls through to the aggregate without interpreting
// them, so recipes stays free of any measurement machinery.

import type { CapabilityDescriptor } from './index.js';
import { buildPlanGraph } from './plan.js';
import type { ExecutionPlan, PlanNode } from './plan.js';

/** One real tool call a node ran, with what it cost — the opaque accounting unit
 * the executor threads through to a caller's cost aggregation. Recipes never
 * interprets these; it only collects them per node and hands the union back. */
export interface RecordedCall {
  /** The tool the call ran (`enact_capability`, `delegate`, …). */
  tool: string;
  /** The concrete model id that ran the work, or `'(none)'` for an inline call. */
  model: string;
  /** FRESH input tokens only — cache read/write are separate below so a caller
   * can price them at their real (cheaper) rates. */
  tokensIn: number;
  tokensOut: number;
  /** Cache-read / cache-write input tokens, SEPARATE from `tokensIn`. */
  cacheRead?: number;
  cacheWrite?: number;
  /** Wall-clock for the call, ms. */
  ms: number;
}

/** The outcome of running one plan node: its produced text, every model call it
 * made (for the cost rollup), and whether it failed. A failed run's dependents
 * can never satisfy their deps, so they are skipped. */
export interface NodeRun {
  /** The node's produced output — threaded into its dependents' directives. */
  text: string;
  /** Every model call this node made, for the whole-run cost aggregation. */
  calls: RecordedCall[];
  /** True when the node's enact errored or its gate failed. */
  failed?: boolean;
}

export interface PlanExecDeps {
  /** Run ONE node: enact its capability with a directive already threaded from
   * upstream results. Injected so the executor is testable without a network;
   * the coordinator provides the real one (a wrapper over `enactCapability`). */
  enactNode: (node: PlanNode, directive: string) => Promise<NodeRun>;
  /** Build a node's directive from the request and its upstream results (the
   * produced text of each capability in `node.dependsOn`). Optional — a sensible
   * default grounds the request with a labelled block per upstream. */
  buildDirective?: (node: PlanNode, request: string, upstream: Map<string, string>) => string;
}

export interface PlanExecResult {
  /** Capability type → produced text, for every node that ran (not the skipped). */
  results: Map<string, string>;
  /** All RecordedCalls across all nodes that ran, for the cost aggregation. */
  calls: RecordedCall[];
  /** The layers as executed; each is the capability types run CONCURRENTLY.
   * `layers.length` is the critical-path depth; the total size is the node
   * count. Order within a layer is stable (sorted by capability). */
  layers: string[][];
  /** Nodes that failed — their transitive dependents were skipped, so a failure
   * leaves a legible partial result rather than throwing. */
  failed: string[];
}

/** The default directive builder: the request, followed by one labelled grounding
 * block per upstream result, so a node sees what its prerequisites produced. */
export function defaultBuildDirective(
  _node: PlanNode,
  request: string,
  upstream: Map<string, string>
): string {
  if (upstream.size === 0) return request;
  const grounding = [...upstream.entries()]
    .map(([capability, text]) => `grounding: ${capability}:\n${text}`)
    .join('\n\n');
  return `${request}\n\n${grounding}`;
}

/**
 * Layer the plan's DAG: layer 0 is the nodes with no in-plan dependency, and
 * layer k is the nodes whose every dependency sits in an earlier layer. PURE and
 * deterministic — membership follows only from `dependsOn`, and each layer is
 * sorted by capability so the order is stable across runs. A dependency naming a
 * capability not in the plan is treated as already-satisfied (it can't be waited
 * on). A cycle (which a well-formed plan never contains) leaves its nodes
 * unlayered rather than looping.
 */
export function layerPlan(plan: ExecutionPlan): PlanNode[][] {
  const inPlan = new Set(plan.nodes.map((n) => n.capability));
  const placed = new Set<string>();
  const layers: PlanNode[][] = [];

  while (placed.size < plan.nodes.length) {
    const ready = plan.nodes.filter(
      (n) => !placed.has(n.capability) && n.dependsOn.every((d) => !inPlan.has(d) || placed.has(d))
    );
    // No node became ready but some remain unplaced → a dependency cycle. Stop
    // rather than loop; the remaining nodes are left unlayered (never runnable).
    if (ready.length === 0) break;
    ready.sort((a, b) => a.capability.localeCompare(b.capability));
    for (const n of ready) placed.add(n.capability);
    layers.push(ready);
  }

  return layers;
}

/**
 * Execute a plan with its independent nodes running CONCURRENTLY. The DAG is
 * layered (`layerPlan`); each layer runs via `Promise.all`, and a barrier between
 * layers means a node never starts before its dependencies' results exist. Before
 * a node runs, its upstream results are gathered and threaded into its directive
 * (`deps.buildDirective`, or a labelled-grounding default).
 *
 * Failure is isolated: a node whose run reports `failed` — or whose `enactNode`
 * throws (caught, treated as failed) — is recorded in `failed`, and its
 * transitive dependents are SKIPPED (they can never satisfy their deps) while
 * independent nodes and layers proceed. This never throws: a failure yields a
 * legible partial result, not a dropped run.
 */
export async function executePlanParallel(
  plan: ExecutionPlan,
  deps: PlanExecDeps
): Promise<PlanExecResult> {
  const buildDirective = deps.buildDirective ?? defaultBuildDirective;
  const layers = layerPlan(plan);

  const results = new Map<string, string>();
  const calls: RecordedCall[] = [];
  const failed = new Set<string>();

  for (const layer of layers) {
    // A node is skipped when any dependency failed or was itself skipped — the
    // failure propagates transitively down the DAG, layer by layer.
    const runnable = layer.filter((n) => !n.dependsOn.some((d) => failed.has(d)));
    for (const n of layer) if (!runnable.includes(n)) failed.add(n.capability);

    const runs = await Promise.all(
      runnable.map(async (node): Promise<[PlanNode, NodeRun]> => {
        const upstream = new Map<string, string>();
        for (const dep of node.dependsOn) {
          const text = results.get(dep);
          if (text !== undefined) upstream.set(dep, text);
        }
        const directive = buildDirective(node, plan.request, upstream);
        try {
          return [node, await deps.enactNode(node, directive)];
        } catch (err) {
          const message = `<enact ${node.capability} failed: ${String(err).slice(0, 200)}>`;
          return [node, { text: message, calls: [], failed: true }];
        }
      })
    );

    for (const [node, run] of runs) {
      calls.push(...run.calls);
      if (run.failed) failed.add(node.capability);
      else results.set(node.capability, run.text);
    }
  }

  return {
    results,
    calls,
    layers: layers.map((layer) => layer.map((n) => n.capability)),
    failed: [...failed],
  };
}

/** A gate verdict over a plan: whether it's safe to spend on, and the findings
 * that failed it. `ok` false means the plan should be aborted, not executed. */
export interface GateVerdict {
  ok: boolean;
  findings: string[];
}

/**
 * Gate a plan before any spend — the "inspect before you spend" control point.
 * PURE. A plan passes only when:
 *  - it has at least one node (an empty plan produces nothing);
 *  - every entry capability resolves to a node in the plan;
 *  - no node depends on a capability the plan doesn't contain (a dangling edge);
 *  - the plan is acyclic — topologically orderable via its `dependsOn` edges.
 *
 * buildPlanGraph already topologically orders and drops unresolvable edges, so a
 * gate failure here signals a plan built some other way, or a corpus/entry
 * mismatch. Findings name what failed so the caller can abort legibly.
 */
export function gatePlan(plan: ExecutionPlan): GateVerdict {
  const findings: string[] = [];
  const present = new Set(plan.nodes.map((n) => n.capability));

  if (plan.nodes.length === 0) {
    findings.push('plan is empty — no capabilities to execute');
  }

  for (const entry of plan.entry) {
    if (!present.has(entry)) {
      findings.push(`entry capability "${entry}" has no node in the plan`);
    }
  }

  for (const node of plan.nodes) {
    for (const dep of node.dependsOn) {
      if (!present.has(dep)) {
        findings.push(`node "${node.capability}" depends on missing capability "${dep}"`);
      }
    }
  }

  if (!isAcyclic(plan.nodes)) {
    findings.push('plan has a dependency cycle — it cannot be topologically ordered');
  }

  return { ok: findings.length === 0, findings };
}

/** Whether a node set's `dependsOn` edges form a DAG — a Kahn peel that consumes
 * every node iff there is no cycle. Edges to absent capabilities are ignored here
 * (the dangling-dep check reports those); this asks only about cyclicity. */
function isAcyclic(nodes: PlanNode[]): boolean {
  const present = new Set(nodes.map((n) => n.capability));
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    indeg.set(n.capability, n.dependsOn.filter((d) => present.has(d)).length);
  }
  const ready = nodes.filter((n) => (indeg.get(n.capability) ?? 0) === 0).map((n) => n.capability);
  let consumed = 0;
  while (ready.length > 0) {
    const t = ready.pop()!;
    consumed++;
    for (const n of nodes) {
      if (n.dependsOn.includes(t)) {
        const d = (indeg.get(n.capability) ?? 0) - 1;
        indeg.set(n.capability, d);
        if (d === 0) ready.push(n.capability);
      }
    }
  }
  return consumed === nodes.length;
}

/** Parse selected ids from a model reply, matching only against the supplied id
 * set, order preserved by the corpus. Word-boundary anchored so a hyphenated id
 * doesn't fire on its substrings (same rule as recipes' parseSelectedIds). PURE
 * string parsing — no model call. */
export function parseEntrySelection(text: string, ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const re = new RegExp(`(?<![a-z-])${id}(?![a-z-])`);
    if (re.test(text) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Build an ExecutionPlan from buildPlanGraph's output. Practices are `[]` — this
 * builds the DAG's cost + parallel structure, not per-node provisioning (that's
 * `planExecution`'s job, which needs an embedder). PURE. */
export function buildExecutionPlan(
  request: string,
  entry: string[],
  corpus: CapabilityDescriptor[]
): ExecutionPlan {
  const graph = buildPlanGraph(entry, corpus);
  const nodes: PlanNode[] = graph.map((g) => ({
    capability: g.capability,
    practices: [],
    dependsOn: g.dependsOn,
    source: g.source,
  }));
  return {
    request,
    entry: graph.filter((g) => g.source === 'retrieved').map((g) => g.capability),
    nodes,
  };
}
