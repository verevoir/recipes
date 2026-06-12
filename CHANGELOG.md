# Changelog

## 0.4.0 — 2026-06-12

**Reasoning call de-pinned from Anthropic** (STDIO-340). Practice provisioning's concern-tagging no longer hardcodes the Anthropic adapter — the model call is injectable, so it can run on DeepSeek / Mistral / any `@verevoir/llm` provider without recipes importing every SDK.

- New exported `ChatFn` type (`(opts: ChatOptions) => Promise<ChatReply>`).
- `selectConcernTags` and `provisionPractices` take an optional trailing `chat: ChatFn` argument, **defaulting to the Anthropic adapter** — fully backward-compatible (existing 2–3 arg callers are unchanged). A host that wants another provider passes its own `chat` (via the `@verevoir/llm` provider of choice).
- `selectEntryCapabilities` (capability narrowing) is still Anthropic-pinned — same de-pin to follow.

## 0.1.0 — 2026-06-04

Initial release (STDIO-278).

- `parseSkill(idHint, raw)` — parse a recipe descriptor `.md` (flat frontmatter + instruction body) into a `SkillDescriptor`. Hand-written, no YAML dependency. Throws `SkillParseError` on a missing frontmatter fence, a missing required field (`id`/`name`/`description`), or an `id` that doesn't match the filename stem.
- `isReasoningSkill(skill)` — true when the recipe has no native `handler` (the ones worth exposing as prompts / inline-LLM tools).
- `renderSkillPrompt(skill, args)` — the instructions plus the supplied non-empty inputs, as the body a host model executes.
- Types: `SkillDescriptor`, `SkillInput`, `SkillInputType`, `SkillModelClass`, `SkillParseError`.

Extracted from the duplicated parsers in the aigency web app and `@verevoir/mcp` so both surfaces share one format definition. Zero runtime dependencies; ESM, Node >= 20.
