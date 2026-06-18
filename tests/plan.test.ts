// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildPlanGraph, planExecution, FOUNDATIONAL } from '../src/engine.js';
import type { CapabilityDescriptor } from '../src/index.js';
import type { RetrievedCapability } from '../src/engine.js';

function cap(type: string, over: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    type,
    postcondition: `you will have ${type}`,
    composes: [],
    nextSteps: [],
    grants: [],
    gate: 'none',
    inputs: [],
    guidance: '',
    ...over,
  };
}

// A small synthetic corpus shaped like the real one: a chain of `composes`
// prerequisites plus an unresolvable artifact edge and a `@fan` suffix.
//   report   composes [analyse-risk, board-summary@sections]   (board-summary unknown → artifact)
//   analyse-risk composes [read-contract]
//   read-contract composes []
//   unrelated  composes []
const SYNTH: CapabilityDescriptor[] = [
  cap('report', { composes: ['analyse-risk', 'board-summary@sections'] }),
  cap('analyse-risk', { composes: ['read-contract'] }),
  cap('read-contract'),
  cap('unrelated'),
];

describe('buildPlanGraph (pure)', () => {
  it('closes over composes to pull in prerequisites the request did not name', () => {
    const graph = buildPlanGraph(['report'], SYNTH);
    const types = graph.map((g) => g.capability).sort();
    // report named directly; analyse-risk + read-contract pulled in; unrelated absent.
    expect(types).toEqual(['analyse-risk', 'read-contract', 'report']);
  });

  it('orders prerequisites before the capabilities that depend on them', () => {
    const order = buildPlanGraph(['report'], SYNTH).map((g) => g.capability);
    expect(order.indexOf('read-contract')).toBeLessThan(order.indexOf('analyse-risk'));
    expect(order.indexOf('analyse-risk')).toBeLessThan(order.indexOf('report'));
  });

  it('wires dependsOn to in-plan composes only, dropping artifact + fan-key edges', () => {
    const graph = buildPlanGraph(['report'], SYNTH);
    const report = graph.find((g) => g.capability === 'report')!;
    // board-summary@sections is an unresolvable artifact edge → not a dependency.
    expect(report.dependsOn).toEqual(['analyse-risk']);
    expect(graph.find((g) => g.capability === 'read-contract')!.dependsOn).toEqual([]);
  });

  it('labels directly-requested capabilities retrieved and prerequisites composed', () => {
    const graph = buildPlanGraph(['report'], SYNTH);
    const bySource = Object.fromEntries(graph.map((g) => [g.capability, g.source]));
    expect(bySource['report']).toBe('retrieved');
    expect(bySource['analyse-risk']).toBe('composed');
    expect(bySource['read-contract']).toBe('composed');
  });

  it('ignores entry types absent from the corpus', () => {
    const graph = buildPlanGraph(['report', 'does-not-exist'], SYNTH);
    expect(graph.map((g) => g.capability)).not.toContain('does-not-exist');
  });

  it('is deterministic across independent builds', () => {
    const a = buildPlanGraph(['report'], SYNTH).map((g) => g.capability);
    const b = buildPlanGraph(['report'], SYNTH).map((g) => g.capability);
    expect(a).toEqual(b);
  });
});

describe('planExecution (offline — injected retrieval + reasoning)', () => {
  // Use the synthetic corpus and stub all model/embedder calls — no network,
  // no API key, fully deterministic.
  //
  //   report composes [analyse-risk, board-summary@sections]
  //   analyse-risk composes [read-contract]
  //   read-contract composes []
  const deps = {
    retrieve: async (): Promise<RetrievedCapability[]> => [{ type: 'report', score: 0.9 }],
    selectEntry: async (): Promise<string[]> => ['report'],
    classifyConcerns: async (): Promise<string[]> => [], // no extra concerns
    apiKey: null,
  };

  it('pulls the entry capability and its composed prerequisites, ordered', async () => {
    const plan = await planExecution('write me a risk report', SYNTH, deps);
    expect(plan.entry).toEqual(['report']);
    const order = plan.nodes.map((n) => n.capability);
    expect(order).toContain('analyse-risk');
    expect(order).toContain('read-contract');
    expect(order.indexOf('read-contract')).toBeLessThan(order.indexOf('analyse-risk'));
    expect(order.indexOf('analyse-risk')).toBeLessThan(order.indexOf('report'));
  });

  it('labels the prerequisite composed and the requested capability retrieved', async () => {
    const plan = await planExecution('write me a risk report', SYNTH, deps);
    const bySource = Object.fromEntries(plan.nodes.map((n) => [n.capability, n.source]));
    expect(bySource['report']).toBe('retrieved');
    expect(bySource['analyse-risk']).toBe('composed');
    expect(bySource['read-contract']).toBe('composed');
  });

  it('provisions the foundational floor onto every node', async () => {
    const plan = await planExecution('write me a risk report', SYNTH, deps);
    for (const node of plan.nodes) {
      for (const p of FOUNDATIONAL) expect(node.practices).toContain(p);
    }
  });
});
