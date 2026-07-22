// The verify contract — shared vocabulary for a capability's enforced
// postcondition. A capability declares a `verify` name (index.ts); the runtime
// resolves it to a Verifier and runs it as a hard gate, looping the producer on
// its findings until clean. `kind` says how conformance is judged — the same
// spectrum the refine/eval loop tools use (deterministic / judge / practices).

/** How a capability's (or practice's) conformance is checked: a mechanical check
 * (gate), a model scored against a rubric (threshold), or irreducible judgement
 * (advisory, not a gate). */
export type VerifyKind = 'deterministic' | 'rubric' | 'prose';

/** One thing a verifier found wrong, model-actionable so a re-produce can fix
 * it. `kind` is the verifier's own finding code (e.g. `DTCG`, `VALUE_DRIFT`). */
export interface VerifyFinding {
  kind: string;
  file?: string;
  where?: string;
  message: string;
}

/** A verifier's verdict. `ok` is the pass/fail (a rubric/prose verifier may pass
 * or fail with no structured findings); `findings` are the actionable detail a
 * re-produce fixes. A deterministic verifier keeps them in lock-step (`ok` ⟺ no
 * findings); use `isClean` rather than reading either field alone.
 *
 * `incomplete` is set by the adversarial reviewer when the model reply contained
 * no nonce-tagged verdict line — meaning the review did not reach its conclusion
 * (likely truncated or off-format). Callers can distinguish this from a genuine
 * rejection and may choose to retry rather than feed findings back to the
 * producer. Optional and additive — existing consumers that ignore unknown fields
 * are unaffected. */
export interface VerifyResult {
  ok: boolean;
  findings: VerifyFinding[];
  incomplete?: true;
}

/** What the runtime hands a verifier. The producer's `result` is grounding for a
 * rubric/judge; a deterministic verifier ignores it and reads the produced
 * artefact back itself (off a branch, off disk) — which is why the host binds
 * its own IO into the closure rather than this carrying a repo handle. */
export interface VerifyInput {
  capability: string;
  /** The verifier name the capability declared (`descriptor.verify`). */
  verify: string;
  /** The producer's final text. */
  result: string;
}

/** The check the runtime runs as a hard postcondition — the producer's output is
 * an INPUT to it, never trusted as final. Async: a real check reads an artefact
 * back or calls a judge. */
export type Verifier = (input: VerifyInput) => Promise<VerifyResult>;

/** True when a run passed its verify — fail-closed across all kinds. A
 * deterministic verifier signals pass by empty findings; a rubric/prose one
 * signals it by `ok` and may carry no structured findings — so EITHER a falsy
 * `ok` or any finding reads as not-clean, and a malformed `{ ok: true,
 * findings: [...] }` stays not-clean too. */
export function isClean(result: VerifyResult): boolean {
  return result.ok && result.findings.length === 0;
}

/** Render findings as model-readable lines for a re-produce directive. */
export function formatFindings(findings: VerifyFinding[]): string {
  return findings
    .map(
      (f) => `- ${f.kind}${f.file ? ` ${f.file}` : ''}${f.where ? ` ${f.where}` : ''}: ${f.message}`
    )
    .join('\n');
}
