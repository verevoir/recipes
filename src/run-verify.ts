// The verify runner — the shared produce→verify→re-produce loop that enforces a
// capability's declared postcondition. A capability that declares a `verify` is
// "done" only when its verifier passes: produce, check, and on a not-clean
// verdict re-produce with the findings folded in, looping to a cap. The
// producer's output is an INPUT to the check, never trusted as final.
//
// PURE of model + IO: `produce` (the host's enact/tool loop) and `verifier` (the
// host's resolved check, reading the artefact back through its own adapter) are
// injected, so the loop is provider-agnostic and unit-testable with no network.
// It is the binary-gate sibling of the score-based refine loop (Ralph
// runRefineLoop); a rubric/prose verify that needs scoring routes through that.

import { isClean, formatFindings, type Verifier, type VerifyFinding } from './verify.js';

/** Default cap on produce→verify attempts. A few passes to fix what the gate
 * found; if it can't, the run is not done rather than shipping unmet work. */
export const DEFAULT_MAX_VERIFY_ATTEMPTS = 3;

/** What the producer is told for one attempt: the findings from the previous
 * verify (empty on the first attempt) to fix, and the 1-based attempt number. */
export interface ProduceAttempt {
  findings: VerifyFinding[];
  attempt: number;
}

export interface RunWithVerifyInput {
  capability: string;
  /** The verifier name the capability declared (`descriptor.verify`). */
  verify: string;
  /** Produce the artefact and return the producer's final text. The first call
   * gets no findings; later calls get the prior verdict's findings to fix. */
  produce: (attempt: ProduceAttempt) => Promise<string>;
  /** The resolved check — reads the produced artefact back and verifies it. */
  verifier: Verifier;
  /** Cap on attempts. Defaults to DEFAULT_MAX_VERIFY_ATTEMPTS. */
  maxAttempts?: number;
}

export interface RunWithVerifyResult {
  /** The converged producer output, or the last attempt's if it never did. */
  result: string;
  /** How many produce→verify attempts ran (1-based). */
  attempts: number;
  /** Whether the verifier ultimately passed. */
  converged: boolean;
  /** The final attempt's findings — empty when converged. */
  findings: VerifyFinding[];
}

/**
 * Run the produce→verify loop. Returns the outcome truthfully (converged or not)
 * rather than throwing — the host decides whether a non-converged run fails the
 * work (`enforceConverged`) or is recorded (the cross-model matrix wants the
 * attempt count, not an exception). Always runs `produce` at least once.
 */
export async function runWithVerify(input: RunWithVerifyInput): Promise<RunWithVerifyResult> {
  const max = Math.max(1, Math.floor(input.maxAttempts ?? DEFAULT_MAX_VERIFY_ATTEMPTS));
  let findings: VerifyFinding[] = [];
  let result = '';

  for (let attempt = 1; attempt <= max; attempt += 1) {
    result = await input.produce({ findings, attempt });
    const verdict = await input.verifier({
      capability: input.capability,
      verify: input.verify,
      result,
    });
    if (isClean(verdict)) {
      return { result, attempts: attempt, converged: true, findings: [] };
    }
    findings = verdict.findings;
  }

  return { result, attempts: max, converged: false, findings };
}

/**
 * Fail-closed gate over a run's outcome: throw when it didn't converge, with the
 * unmet findings, so a host that must not ship red is a one-liner. Returns the
 * result unchanged when it converged.
 */
export function enforceConverged(
  capability: string,
  verify: string,
  outcome: RunWithVerifyResult
): RunWithVerifyResult {
  if (!outcome.converged) {
    throw new Error(
      `${capability} failed its verify (${verify}) after ${outcome.attempts} attempt(s):\n${formatFindings(outcome.findings)}`
    );
  }
  return outcome;
}
