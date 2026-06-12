// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  parseConcernTags,
  findPractices,
  CONCERN_MENU,
  selectConcernTags,
  provisionPractices,
  FOUNDATIONAL,
} from '../src/engine.js';

/** A fake chat that returns canned model output — proves the reasoning call is
 * the INJECTED one, not the hardcoded Anthropic adapter (no network, no SDK). */
function fakeChat(reply: string) {
  return vi.fn(async () => ({ content: reply, usage: {} as never, stopReason: 'end_turn' }));
}

describe('parseConcernTags', () => {
  it('parses a single hyphenated id from model output', () => {
    const text = '- architecture-and-docs\n- testing';
    const tags = parseConcernTags(text);
    expect(tags).toContain('architecture-and-docs');
    expect(tags).toContain('testing');
  });

  it('does not match a partial substring of a hyphenated id', () => {
    // "testing" appears inside "automated-testing" but should not double-fire;
    // the id "testing" must match only when not preceded/followed by [a-z-].
    const text = '- testing';
    const tags = parseConcernTags(text);
    // Only 'testing' should be present, not 'apis-and-contracts' or others.
    expect(tags).toEqual(['testing']);
  });

  it('returns empty array when no known ids appear', () => {
    expect(parseConcernTags('nothing here at all')).toEqual([]);
  });

  it('deduplicates repeated ids', () => {
    const text = '- security\n- security';
    const tags = parseConcernTags(text);
    expect(tags.filter((t) => t === 'security')).toHaveLength(1);
  });

  it('handles all CONCERN_MENU ids round-trip', () => {
    const allIds = CONCERN_MENU.map((c) => `- ${c.id}`).join('\n');
    const parsed = parseConcernTags(allIds);
    expect(parsed).toHaveLength(CONCERN_MENU.length);
    for (const c of CONCERN_MENU) {
      expect(parsed).toContain(c.id);
    }
  });
});

describe('findPractices', () => {
  it('returns practices for a known concern tag', () => {
    const practices = findPractices(['testing']);
    expect(practices).toContain('automated-testing');
    expect(practices).toContain('test-pyramid');
  });

  it('returns a deduped union across multiple concern tags', () => {
    // 'input-validation' appears in both apis-and-contracts and errors-and-resilience.
    const practices = findPractices(['apis-and-contracts', 'errors-and-resilience']);
    const count = practices.filter((p) => p === 'input-validation').length;
    expect(count).toBe(1);
  });

  it('ignores unknown tags without error', () => {
    expect(() => findPractices(['not-a-real-concern'])).not.toThrow();
    expect(findPractices(['not-a-real-concern'])).toEqual([]);
  });

  it('returns an empty array for no tags', () => {
    expect(findPractices([])).toEqual([]);
  });
});

describe('selectConcernTags — provider-agnostic via injected chat (STDIO-340)', () => {
  it('classifies through the injected chat, not the Anthropic adapter', async () => {
    const chat = fakeChat('- security\n- testing');
    const tags = await selectConcernTags('handle a secret token', 'key', 'reasoning', chat);
    expect(chat).toHaveBeenCalledOnce();
    expect(tags).toContain('security');
    expect(tags).toContain('testing');
  });
});

describe('provisionPractices — injected chat', () => {
  it('threads the injected chat through tagging and unions concern practices with the floor', async () => {
    const chat = fakeChat('- security');
    const practices = await provisionPractices(
      { prose: 'store a secret' },
      'key',
      'reasoning',
      chat
    );
    expect(chat).toHaveBeenCalledOnce();
    for (const f of FOUNDATIONAL) expect(practices).toContain(f);
    expect(practices).toContain('secret-handling');
  });

  it('skips the model call entirely when declaredTags are supplied', async () => {
    const chat = fakeChat('should not be called');
    const practices = await provisionPractices(
      { prose: 'x', declaredTags: ['security'] },
      null,
      'reasoning',
      chat
    );
    expect(chat).not.toHaveBeenCalled();
    expect(practices).toContain('secret-handling');
  });
});
