// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isClean, formatFindings, type VerifyFinding, type VerifyResult } from '../src/engine.js';

describe('isClean', () => {
  it('is true only when the run passed and found nothing', () => {
    expect(isClean({ ok: true, findings: [] })).toBe(true);
  });

  it('is false for a rubric/prose fail that carries no structured findings', () => {
    // ok is the verdict; a rubric verifier can fail with an empty findings list.
    expect(isClean({ ok: false, findings: [] })).toBe(false);
  });

  it('is false when there are findings, even on a malformed ok:true verdict', () => {
    const result: VerifyResult = {
      ok: true,
      findings: [{ kind: 'DTCG', message: 'bad schema' }],
    };
    expect(isClean(result)).toBe(false);
  });
});

describe('formatFindings', () => {
  it('renders kind, file, where and message as one line each', () => {
    const findings: VerifyFinding[] = [
      {
        kind: 'VALUE_DRIFT',
        file: 'design-language/colour.md',
        where: 'line 12',
        message: 're-types token value 4px',
      },
    ];
    expect(formatFindings(findings)).toBe(
      '- VALUE_DRIFT design-language/colour.md line 12: re-types token value 4px'
    );
  });

  it('omits the optional file and where when absent', () => {
    expect(formatFindings([{ kind: 'NO_TOKENS', message: 'no tokens in pack' }])).toBe(
      '- NO_TOKENS: no tokens in pack'
    );
  });

  it('renders one line per finding', () => {
    const out = formatFindings([
      { kind: 'A', message: 'first' },
      { kind: 'B', message: 'second' },
    ]);
    expect(out.split('\n')).toEqual(['- A: first', '- B: second']);
  });
});
