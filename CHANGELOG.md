# Changelog

## 0.6.0 — 2026-06-15

- **`retrieveCapabilities` — host-agnostic capability prose-matching** (STDIO-328). Matches a piece of work (prose) against a capability corpus and surfaces the top-`k` as `{ type, summary }`, built on the existing `buildCapabilityIndex`. The caller loads the corpus (source-specific) and injects the `Embedder`, so the MCP **and** the website can drive the *same* matcher rather than each owning a copy — capability matching no longer has to live inside the MCP, which locked the website out. `SurfacedCapability` is exported alongside. Pure orchestration over the existing retrieval primitive; no source-reading, no bundled embedder.

## 0.5.0 — 2026-06-12

**`@verevoir/llm` is now an optional `peerDependency`** (was a direct dependency) (STDIO-343). As a direct dependency it let npm install a **nested** `@verevoir/llm` under recipes when a consumer pinned a different range — two module instances, two model catalogues, and the host's module mocks missing recipes' copy (the cause of a red deploy). As a peer, the consumer's single `@verevoir/llm` is used.

- Only the `/engine` subpath (provisioning / retrieval / plan) needs `@verevoir/llm`; the main entry (the skill / capability parsers) doesn't — so the peer is **optional**. `@anthropic-ai/sdk` stays an optional peer.
- Added to recipes' own `devDependencies` so its tests + build still resolve it.
- Consumers (`aigency-web`, `@verevoir/mcp`) already depend on `@verevoir/llm` directly, so there's nothing for them to change.

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
