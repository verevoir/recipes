import { describe, it, expect } from 'vitest';
import {
  parseSkill,
  isReasoningSkill,
  renderSkillPrompt,
  SkillParseError,
  parseCapability,
  CapabilityParseError,
} from '../src/index.js';

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

describe('parseCapability — unified descriptor', () => {
  it('parses a native conversation-tool capability with typed inputs', () => {
    const md = `---
type: add-infrastructure
name: Add infrastructure
description: Add one infra concept.
execution: native
gate: none
inputs:
  - repoName: string (required) — the repo
  - params: string — optional settings
postcondition: you will have it
---
guidance body`;
    const cap = parseCapability('add-infrastructure', md);
    expect(cap.execution).toBe('native');
    expect(cap.name).toBe('Add infrastructure');
    expect(cap.description).toContain('Add one infra concept');
    expect(cap.inputs).toHaveLength(2);
    expect(cap.inputs[0]).toEqual({
      name: 'repoName',
      type: 'string',
      required: true,
      description: 'the repo',
    });
    expect(cap.inputs[1].required).toBe(false);
    expect(cap.guidance).toBe('guidance body');
  });

  it('is backward-compatible: a legacy objective-tree descriptor has no inputs and undefined execution', () => {
    const md = `---
type: connect-existing-repos
postcondition: you will have each attached repo reviewed
composes: [update-project-documentation, review-repo]
---`;
    const cap = parseCapability('connect-existing-repos', md);
    expect(cap.inputs).toEqual([]);
    expect(cap.execution).toBeUndefined();
    expect(cap.name).toBeUndefined();
    expect(cap.composes).toEqual(['update-project-documentation', 'review-repo']);
  });

  it('treats an unknown execution value as undefined', () => {
    const md = `---
type: x
postcondition: you will have x
execution: wibble
---`;
    expect(parseCapability('x', md).execution).toBeUndefined();
  });

  it('still enforces type matching the filename and the required fields', () => {
    const md = `---
type: a
postcondition: you will have a
---`;
    expect(() => parseCapability('b', md)).toThrow(CapabilityParseError);
  });

  it('parses grants as an inline list, defaulting to read-only when absent (STDIO-392)', () => {
    const withGrants = `---
type: change-on-a-branch
postcondition: you will have a branch
grants: [write]
---`;
    expect(parseCapability('change-on-a-branch', withGrants).grants).toEqual(['write']);

    const readOnly = `---
type: review-repo
postcondition: you will have a review
---`;
    expect(parseCapability('review-repo', readOnly).grants).toEqual([]);
  });

  it('ignores an unrecognised descriptor field rather than failing (forward-compatible)', () => {
    const md = `---
type: x
postcondition: you will have x
someFutureField: whatever
---`;
    expect(() => parseCapability('x', md)).not.toThrow();
  });
});
