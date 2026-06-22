# Changelog

## 0.9.0 — 2026-06-22

- **Capability `verify` — the enforced postcondition** (STDIO-451). `parseCapability` now reads a `verify` scalar into `CapabilityDescriptor.verify` — the name of a deterministic check (e.g. `design-pack`) the consuming runtime runs as a **hard** postcondition: it runs the named verifier against what the model produced and loops the model on its findings until it passes. A prose `postcondition` is a hope; `verify` is enforced — the model's output is an input to the check, never trusted as final. Absent means the capability has no mechanically-checkable postcondition (judgement-shaped output). Forward-compatible (an older parser ignores the field, like `grants`). The corpus data half (the field on capabilities) and the executor that _honours_ it land separately (aigency-guardrails + aigency-web).

## 0.7.0 — 2026-06-18

- **Capability `grants` — least-permission tool declaration** (STDIO-392). `parseCapability` now reads a `grants` inline-list field into `CapabilityDescriptor.grants` — the tool permissions a capability's executor may use **beyond the read-only floor**. Empty (the default) means read-only: least permission, the safe default. The token defined today is `write` (modify working-repo files); more are added as the corpus is classified, and the executor that _honours_ grants (constraining the toolbelt) is a follow-on in the consuming app. The parser now also **deliberately ignores unrecognised descriptor fields**, so this field — and later `tier`/`portability` — never breaks an older parser (forward-compatible). The corpus data half (the field on capabilities) lands in aigency-guardrails.

## 0.6.0 — 2026-06-15

- **`retrieveCapabilities` — host-agnostic capability prose-matching** (STDIO-328). Matches a piece of work (prose) against a capability corpus and surfaces the top-`k` as `{ type, summary }`, built on the existing `buildCapabilityIndex`. The caller loads the corpus (source-specific) and injects the `Embedder`, so the MCP **and** the website can drive the _same_ matcher rather than each owning a copy — capability matching no longer has to live inside the MCP, which locked the website out. `SurfacedCapability` is exported alongside. Pure orchestration over the existing retrieval primitive; no source-reading, no bundled embedder.

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
