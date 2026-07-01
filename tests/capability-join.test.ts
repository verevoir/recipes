// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  capabilityWithRun,
  capabilitiesWithRun,
  parseCapability,
  type CapabilityDescriptor,
} from '../src/index.js';

// A minimal parsed descriptor — the DATA half. The join only reads `.type`, so
// this is enough to exercise it against synthetic executors (the CODE half).
function descriptor(type: string): CapabilityDescriptor {
  return parseCapability(type, `---\ntype: ${type}\npostcondition: you will have ${type}\n---\n`);
}

const corpus = [descriptor('review-repo'), descriptor('discover-product-need')];

describe('capabilityWithRun — the corpus↔executor join', () => {
  const executors = { 'review-repo': () => 'ran review-repo' };

  it('attaches the executor for a type that has one', () => {
    const cap = capabilityWithRun(corpus, 'review-repo', executors);
    expect(cap?.type).toBe('review-repo');
    expect(cap?.run).toBe(executors['review-repo']);
  });

  it('joins with run undefined for a conversation-only capability (no executor)', () => {
    const cap = capabilityWithRun(corpus, 'discover-product-need', executors);
    expect(cap).toBeDefined();
    expect(cap?.run).toBeUndefined();
  });

  it('returns undefined when no descriptor of that type exists (consumer still inline-dispatches)', () => {
    expect(capabilityWithRun(corpus, 'connect-cloud', executors)).toBeUndefined();
  });

  it('is generic over the executor signature — a consumer picks its own', () => {
    // A different consumer's shape (async, its own args) type-checks + joins.
    const other: Record<string, (x: number) => Promise<number>> = {
      'review-repo': async (x) => x + 1,
    };
    const cap = capabilityWithRun(corpus, 'review-repo', other);
    expect(typeof cap?.run).toBe('function');
  });

  it('carries the descriptor data through unchanged', () => {
    const cap = capabilityWithRun(corpus, 'review-repo', executors);
    expect(cap?.postcondition).toBe('you will have review-repo');
    expect(Array.isArray(cap?.composes)).toBe(true);
  });
});

describe('capabilitiesWithRun — bulk join', () => {
  it('joins every descriptor, run undefined where the consumer has none', () => {
    const joined = capabilitiesWithRun(corpus, { 'review-repo': () => {} });
    expect(joined.map((c) => c.type)).toEqual(['review-repo', 'discover-product-need']);
    expect(typeof joined[0].run).toBe('function');
    expect(joined[1].run).toBeUndefined();
  });
});
