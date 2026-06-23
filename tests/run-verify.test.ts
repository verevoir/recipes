// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  runWithVerify,
  enforceConverged,
  type ProduceAttempt,
  type Verifier,
  type VerifyFinding,
  type RunWithVerifyResult,
} from '../src/engine.js';

/** A verifier scripted to return a fixed sequence of verdicts, one per call. */
function scriptedVerifier(verdicts: Array<{ ok: boolean; findings: VerifyFinding[] }>): {
  verifier: Verifier;
  calls: () => number;
} {
  let i = 0;
  return {
    verifier: async () => verdicts[Math.min(i++, verdicts.length - 1)],
    calls: () => i,
  };
}

const finding = (message: string): VerifyFinding => ({ kind: 'DRIFT', message });

describe('runWithVerify', () => {
  it('produces once and converges when the first verify passes', async () => {
    let produceCalls = 0;
    const { verifier } = scriptedVerifier([{ ok: true, findings: [] }]);
    const out = await runWithVerify({
      capability: 'ingest-style-guide',
      verify: 'design-pack',
      produce: async () => {
        produceCalls += 1;
        return 'PACK';
      },
      verifier,
    });
    expect(out).toEqual({ result: 'PACK', attempts: 1, converged: true, findings: [] });
    expect(produceCalls).toBe(1);
  });

  it('re-produces with the prior findings and converges on the fix', async () => {
    const seen: ProduceAttempt[] = [];
    const { verifier } = scriptedVerifier([
      { ok: false, findings: [finding('re-typed 4px')] },
      { ok: true, findings: [] },
    ]);
    const out = await runWithVerify({
      capability: 'ingest-style-guide',
      verify: 'design-pack',
      produce: async (attempt) => {
        seen.push(attempt);
        return `PACK-${attempt.attempt}`;
      },
      verifier,
    });
    expect(out).toEqual({ result: 'PACK-2', attempts: 2, converged: true, findings: [] });
    // first attempt has no findings; the second is handed the gate's findings.
    expect(seen[0]).toEqual({ attempt: 1, findings: [] });
    expect(seen[1]).toEqual({ attempt: 2, findings: [finding('re-typed 4px')] });
  });

  it('fails closed at the cap, reporting the unmet findings rather than throwing', async () => {
    let produceCalls = 0;
    const { verifier, calls } = scriptedVerifier([
      { ok: false, findings: [finding('still drifting')] },
    ]);
    const out = await runWithVerify({
      capability: 'ingest-style-guide',
      verify: 'design-pack',
      maxAttempts: 3,
      produce: async () => {
        produceCalls += 1;
        return 'BAD';
      },
      verifier,
    });
    expect(out.converged).toBe(false);
    expect(out.attempts).toBe(3);
    expect(out.findings).toEqual([finding('still drifting')]);
    expect(produceCalls).toBe(3);
    expect(calls()).toBe(3); // verified every attempt
  });

  it('keeps looping on a rubric-style fail that carries no structured findings', async () => {
    const { verifier } = scriptedVerifier([
      { ok: false, findings: [] }, // a rubric fail — verdict in ok, no findings
      { ok: true, findings: [] },
    ]);
    const out = await runWithVerify({
      capability: 'review',
      verify: 'rubric-check',
      produce: async () => 'DRAFT',
      verifier,
    });
    expect(out.converged).toBe(true);
    expect(out.attempts).toBe(2);
  });

  it('always produces at least once, even with a zero/negative cap', async () => {
    let produceCalls = 0;
    const { verifier } = scriptedVerifier([{ ok: true, findings: [] }]);
    await runWithVerify({
      capability: 'c',
      verify: 'v',
      maxAttempts: 0,
      produce: async () => {
        produceCalls += 1;
        return 'X';
      },
      verifier,
    });
    expect(produceCalls).toBe(1);
  });
});

describe('enforceConverged', () => {
  const converged: RunWithVerifyResult = {
    result: 'PACK',
    attempts: 1,
    converged: true,
    findings: [],
  };
  const failed: RunWithVerifyResult = {
    result: 'BAD',
    attempts: 3,
    converged: false,
    findings: [finding('re-typed 4px')],
  };

  it('returns the outcome unchanged when it converged', () => {
    expect(enforceConverged('c', 'design-pack', converged)).toBe(converged);
  });

  it('throws with the verifier name, attempt count and unmet findings when it did not', () => {
    expect(() => enforceConverged('ingest-style-guide', 'design-pack', failed)).toThrow(
      /ingest-style-guide failed its verify \(design-pack\) after 3 attempt\(s\)[\s\S]*re-typed 4px/
    );
  });
});
