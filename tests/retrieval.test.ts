// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCapabilityIndex,
  clearCapabilityIndexCache,
  addressingText,
  retrieveCapabilities,
  type Embedder,
} from '../src/engine.js';
import type { CapabilityDescriptor } from '../src/index.js';

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

/**
 * A stub embedder mapping each capability's addressing text (and any query
 * prose) to a caller-supplied vector, so the test controls cosine scores
 * exactly.
 */
function stubEmbedder(vectors: Record<string, number[]>): Embedder {
  return {
    id: 'stub-embedder',
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => {
        const v = vectors[t];
        if (!v) throw new Error(`stub embedder: no vector for "${t}"`);
        return v;
      });
    },
  };
}

describe('capability-retrieval ranking (stub embedder)', () => {
  beforeEach(() => {
    clearCapabilityIndexCache();
  });

  it('ranks capabilities by cosine to the query and truncates to k', async () => {
    // Three capabilities at known angles; the query points straight at `near`.
    const corpus = [
      cap('near', { description: 'A' }),
      cap('mid', { description: 'B' }),
      cap('far', { description: 'C' }),
    ];
    const query = 'find me near';
    const embedder = stubEmbedder({
      // addressingText is `description` here (no guidance body).
      A: [1, 0], // near
      B: [0.7, 0.7], // mid
      C: [0, 1], // far
      [query]: [1, 0],
    });

    const index = await buildCapabilityIndex(corpus, embedder);
    const top2 = await index.retrieve(query, 2);

    expect(top2.map((r) => r.type)).toEqual(['near', 'mid']);
    expect(top2).toHaveLength(2);
    // Scores are descending and the top is the exact match (cosine 1).
    expect(top2[0].score).toBeCloseTo(1, 5);
    expect(top2[0].score).toBeGreaterThan(top2[1].score);
  });

  it('returns the full ranking when k exceeds the corpus size', async () => {
    const corpus = [cap('a', { description: 'A' }), cap('b', { description: 'B' })];
    const query = 'q';
    const index = await buildCapabilityIndex(
      corpus,
      stubEmbedder({ A: [1, 0], B: [0, 1], q: [0, 1] })
    );

    const ranked = await index.retrieve(query, 50);
    expect(ranked.map((r) => r.type)).toEqual(['b', 'a']);
    expect(ranked).toHaveLength(2);
  });

  it('addresses a capability by description, falling back to postcondition + body lede', () => {
    expect(addressingText(cap('x', { description: 'do the thing' }))).toBe('do the thing');

    // No description → postcondition is the lead; the first guidance paragraph
    // is appended (later paragraphs dropped).
    const withBody = cap('y', {
      description: undefined,
      postcondition: 'you will have Y',
      guidance: 'First **para** of guidance.\n\nSecond para is dropped.',
    });
    expect(addressingText(withBody)).toBe('you will have Y First para of guidance.');
  });
});

describe('retrieveCapabilities (surface matches)', () => {
  beforeEach(() => {
    clearCapabilityIndexCache();
  });

  it('surfaces the top-k matches as { type, summary }, ranked, summary from the description', async () => {
    const corpus = [
      cap('deploy-thing', { description: 'Deploy the service' }),
      cap('test-thing', { description: 'Run the tests' }),
    ];
    const query = 'ship to production';
    const embedder = stubEmbedder({
      'Deploy the service': [1, 0],
      'Run the tests': [0, 1],
      [query]: [1, 0],
    });

    const out = await retrieveCapabilities(query, corpus, embedder, 2);

    expect(out).toEqual([
      { type: 'deploy-thing', summary: 'Deploy the service' },
      { type: 'test-thing', summary: 'Run the tests' },
    ]);
  });

  it('returns [] for an empty corpus', async () => {
    const embedder = stubEmbedder({});
    expect(await retrieveCapabilities('anything', [], embedder)).toEqual([]);
  });
});
