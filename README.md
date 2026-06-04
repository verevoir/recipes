# @verevoir/recipes

The **recipe-descriptor format and parser** — shared plumbing for every surface
that loads recipes. A recipe is a single `.md` file: flat frontmatter declaring
a parameterised procedure (typed inputs → instructions → a result), plus an
instruction body. A host compiles it to a chat-time tool, an MCP prompt, or runs
it inline.

Zero runtime dependencies. The parser is hand-written (no YAML dep), matching
the descriptor convention used across the foundation.

> This package is the **plumbing**, not the content. The recipes themselves
> (the instructions an LLM runs) live wherever a project keeps them — typically
> a guardrails repo — and are loaded at runtime. A different corpus is a
> different set of recipes, with no code change.

## Install

```bash
npm install @verevoir/recipes
```

## The format

```
---
id: analyse_contract_risk
name: Analyse Contract Risk
description: Surface risky clauses with severity and mitigations.
tags: [contract, risk, legal]
model_class: reasoning
inputs:
  - contract_text: string (required) — the full contract text to analyse
  - party: string — which party you are advising
output: contract-risk — risk findings with severity, rationale, and mitigations
---
You are a commercial contracts risk reviewer. Identify risky clauses…
```

- `id` (required) — canonical id; must equal the filename stem.
- `name`, `description` (required) — human label + one-line summary.
- `tags` — inline list, for discovery.
- `model_class` — `reasoning` (default) or `extraction`; the tier an inline run uses.
- `inputs` — block list of `- <name>: <type> (required) — <description>`. Type defaults to `string`; `(required)` is optional; the em-dash (or `--`) precedes the description.
- `output` — `<kind> — <description>` of what the recipe produces.
- `handler` — when set, the recipe is **deterministic code** (e.g. `fetch_url`), not a reasoning prompt.
- `agent` — optional A2A endpoint an executor may delegate to.
- The body after the closing `---` is the instructions.

## Usage

```ts
import { parseSkill, isReasoningSkill, renderSkillPrompt } from '@verevoir/recipes';

const recipe = parseSkill('analyse_contract_risk', markdown);

// Reasoning recipes are the ones worth exposing as a prompt / inline tool;
// handler-backed ones are deterministic code the host usually already has.
if (isReasoningSkill(recipe)) {
  // Render the prompt a host model executes: instructions + supplied inputs.
  const prompt = renderSkillPrompt(recipe, { contract_text: text });
  // → feed `prompt` to your model, or wrap as an MCP prompt / chat tool.
}
```

`parseSkill` throws `SkillParseError` on a malformed descriptor (no frontmatter
fence, missing required field, or an `id` that doesn't match the filename).

## API

- `parseSkill(idHint: string, raw: string): SkillDescriptor` — parse one descriptor.
- `isReasoningSkill(skill: SkillDescriptor): boolean` — true when there's no native `handler`.
- `renderSkillPrompt(skill, args): string` — instructions + the supplied non-empty inputs.
- Types: `SkillDescriptor`, `SkillInput`, `SkillInputType`, `SkillModelClass`, `SkillParseError`.

## Naming

The function/type names keep the `Skill*` prefix (the descriptors originated as
Agent-Oriented-Architecture "skills"); the package is named **recipes** to avoid
collision with the host's _capability_ concept and with model-provider "Skills".
