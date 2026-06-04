import { describe, it, expect } from 'vitest';
import { parseSkill, isReasoningSkill, renderSkillPrompt, SkillParseError } from '../src/index.js';

const FULL = `---
id: evaluate_cv
name: Evaluate CV
description: Score a CV against role criteria.
tags: [cv, evaluation]
model_class: extraction
inputs:
  - cv_text: string (required) — the candidate's CV text
  - criteria: string — the role criteria to score against
output: evaluation — per-criterion scores and a recommendation
---
You are a careful CV evaluator. Score the CV.`;

const NATIVE = `---
id: fetch_url
name: Fetch URL
description: Fetch a URL and extract its text.
handler: fetchUrl
agent: https://example.com/a2a/fetch
---
(native handler)`;

describe('parseSkill', () => {
  it('parses the full descriptor shape', () => {
    const s = parseSkill('evaluate_cv', FULL);
    expect(s.id).toBe('evaluate_cv');
    expect(s.name).toBe('Evaluate CV');
    expect(s.tags).toEqual(['cv', 'evaluation']);
    expect(s.modelClass).toBe('extraction');
    expect(s.inputs).toEqual([
      { name: 'cv_text', type: 'string', required: true, description: "the candidate's CV text" },
      {
        name: 'criteria',
        type: 'string',
        required: false,
        description: 'the role criteria to score against',
      },
    ]);
    expect(s.output).toEqual({
      kind: 'evaluation',
      description: 'per-criterion scores and a recommendation',
    });
    expect(s.instructions).toContain('CV evaluator');
    expect(isReasoningSkill(s)).toBe(true);
  });

  it('defaults model_class to reasoning when absent', () => {
    const s = parseSkill('x', `---\nid: x\nname: X\ndescription: d\n---\nbody`);
    expect(s.modelClass).toBe('reasoning');
  });

  it('reads a native handler + agent and marks it non-reasoning', () => {
    const s = parseSkill('fetch_url', NATIVE);
    expect(s.handler).toBe('fetchUrl');
    expect(s.agentUrl).toBe('https://example.com/a2a/fetch');
    expect(isReasoningSkill(s)).toBe(false);
  });

  it('rejects an id that does not match the filename', () => {
    expect(() => parseSkill('wrong', FULL)).toThrow(SkillParseError);
  });

  it('rejects a descriptor missing a required field', () => {
    expect(() => parseSkill('x', `---\nid: x\nname: X\n---\nbody`)).toThrow(/description/);
  });

  it('rejects a descriptor with no frontmatter fence', () => {
    expect(() => parseSkill('x', 'no fence here')).toThrow(SkillParseError);
  });
});

describe('renderSkillPrompt', () => {
  const s = parseSkill('evaluate_cv', FULL);

  it('appends only supplied non-empty inputs under the instructions', () => {
    const text = renderSkillPrompt(s, { cv_text: 'JANE DOE CV', criteria: '' });
    expect(text).toContain('CV evaluator');
    expect(text).toContain('### cv_text');
    expect(text).toContain('JANE DOE CV');
    expect(text).not.toContain('### criteria');
  });

  it('returns the bare instructions when no inputs are supplied', () => {
    expect(renderSkillPrompt(s, {})).toBe(s.instructions);
  });
});
