// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isClean, formatFindings, type VerifyFinding, type VerifyResult } from '../src/engine.js';

describe('isClean', () => {
  it('is true for a verdict with no findings', () => {
    expect(isClean({ ok: true, findings: [] })).toBe(true);
  });

  it('is false when there are findings, regardless of the ok flag', () => {
    const result: VerifyResult = {
      ok: true, // a malformed verdict — findings are the source of truth
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
