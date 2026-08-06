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
  /**
   * The verifier never produced a verdict — a MECHANISM failure, not a judgement
   * on the work. Distinct from `converged: false`, which means the verifier
   * looked and rejected. Callers that report "failed its verify" must not say
   * that about a verify that never ran.
   */
  unverified?: boolean;
}

/**
 * How many times to re-ask a verifier that returned no verdict.
 *
 * Re-asking is the right move and re-PRODUCING is not: an incomplete verdict
 * says nothing about the artefact, so there is nothing for the producer to fix,
 * and handing it the mechanism's error message ("the reviewer did not emit a
 * verdict line") sends it chasing a defect that is not in its output.
 */
const MAX_VERIFIER_RETRIES = 2;

/**
 * Run the produce→verify loop. Returns the outcome truthfully (converged or not)
 * rather than throwing — the host decides whether a non-converged run fails the
 * work (`enforceConverged`) or is recorded (the cross-model matrix wants the
 * attempt count, not an exception). Always runs `produce` at least once.
 */
export async function runWithVerify(input: RunWithVerifyInput): Promise<RunWithVerifyResult> {
  // Non-finite (NaN/Infinity from a `Number(unset_env)` or a bad config) falls
  // back to the default — `??` only catches null/undefined, and a NaN cap would
  // make the loop run zero attempts, silently skipping the work.
  const requested = input.maxAttempts;
  const cap = Number.isFinite(requested) ? (requested as number) : DEFAULT_MAX_VERIFY_ATTEMPTS;
  const max = Math.max(1, Math.floor(cap));
  let findings: VerifyFinding[] = [];
  let result = '';

  for (let attempt = 1; attempt <= max; attempt += 1) {
    result = await input.produce({ findings, attempt });
    const ask = () =>
      input.verifier({ capability: input.capability, verify: input.verify, result });

    let verdict = await ask();
    // `incomplete` is the verifier saying it did not run to conclusion — a
    // truncated reply, no tagged verdict line, or more than one. Re-ask it;
    // do NOT treat its message as a finding about the work.
    for (let retry = 0; verdict.incomplete && retry < MAX_VERIFIER_RETRIES; retry += 1) {
      verdict = await ask();
    }
    if (verdict.incomplete) {
      // Out of retries with still no verdict. Stop, and say which kind of
      // failure this is: reporting it as a rejection would present a review that
      // never happened as a review that said no.
      return {
        result,
        attempts: attempt,
        converged: false,
        findings: verdict.findings,
        unverified: true,
      };
    }

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
  if (outcome.unverified) {
    throw new Error(
      `${capability} could not be verified — ${verify} never produced a verdict after ${outcome.attempts} attempt(s). This is a verifier failure, NOT a rejection of the work:\n${formatFindings(outcome.findings)}`
    );
  }
  if (!outcome.converged) {
    throw new Error(
      `${capability} failed its verify (${verify}) after ${outcome.attempts} attempt(s):\n${formatFindings(outcome.findings)}`
    );
  }
  return outcome;
}
