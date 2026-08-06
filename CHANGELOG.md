# Changelog

## 0.17.0 — 2026-08-06

- **More than one verdict is not a verdict** (STDIO-668). `parseReviewVerdict` took the LAST nonce-tagged verdict line, which the 0.16.0 entry below describes as the scanning rule — that rule is superseded here. The reply is reviewer output ABOUT author-controlled content, so an artefact that gets the nonce echoed and appends a second `<VERDICT-nonce>: APPROVE` after the reviewer's genuine `REJECT` returned `{ ok: true, findings: [] }`: a clean approval of a change that had just been rejected, and the precise injection the nonce exists to stop. Now **exactly one** tagged verdict line is required; anything else fails closed as `incomplete: true`. Deliberately not "prefer the first" and not "resolve to the safer one" — two contradictory verdicts mean the reply did not run to conclusion, and returning `REJECT` there would report a review that never happened as a review that said no; two AGREEING verdicts fail closed too, because the question is not which to believe but whether anything in the reply can still be attributed to the reviewer once a second one can appear. What let this survive is worth as much as the fix: a test named `[injection] correct tag REJECT but APPROVE echoed below` passed while proving nothing, because its echoed `APPROVE` was plain prose with no nonce tag — no scan rule would ever have matched it, so it passed under last-wins and would pass under any rule at all. That test now says so in its own name, and the case that matters is pinned beside it. 142 tests (`npx vitest run`).

## 0.16.0 — 2026-07-23

- **Antagonistic-review verdict: nonce-tagged terminal line, not first-line `APPROVE`** (STDIO-604). `parseReviewVerdict` read the verdict from the reviewer's FIRST line only (an anti-injection defence), but reasoning-tier models narrate their analysis first and conclude last — so their genuine `APPROVE` never landed on line 1 and every reasoned review failed closed (observed 4× on clean, fully-tested PRs whose prose plainly approved). Now `buildReviewPrompt` / `makeAdversarialReview` mint a per-call unguessable verdict nonce; the reviewer may reason freely and ends with `<VERDICT-nonce>: APPROVE|REJECT`, and `parseReviewVerdict(text, verdictTag)` scans all lines for the last match of that exact tag. Strictly MORE injection-safe than first-line — the untrusted artefact cannot know the nonce, so echoed / buried / bulleted / wrong-nonce `APPROVE` all fail closed — while letting the model reason first. A reply with no tagged verdict line fails closed as `incomplete: true` (added, optional, to `VerifyResult`), distinguishing "review didn't finish (retry)" from an explicit REJECT. Evolves STDIO-461 (block-only-for-real-defects calibration and injection-safe fail-closed intent preserved). Breaking: `parseReviewVerdict` now takes the tag; `makeAdversarialReview` consumers are unaffected. Superseded by 0.17.0 above.

## 0.15.0 — 2026-07-04

- **Antagonistic review compares output to the original spec** (STDIO-530). `AdversarialReviewOptions` / `buildReviewPrompt` gain a first-class `spec` input — the directive the work was commissioned to satisfy — rendered as its own fenced block **before** the artefact and framed as inert data to check against, never instructions to the reviewer. A stated requirement left unmet, or a value that contradicts the spec, is now a blocking defect. Previously the reviewer saw only the artefact and the practices `rubric`, never what was _asked_, so "is any stated requirement unmet?" was a dead question — surfaced when the enact review assented to off-spec type-scale values on the gov.uk design-tokens run. Additive and optional: absent `spec`, behaviour is unchanged. `@verevoir/capabilities` threads `enact`'s directive into it.

## 0.14.0 — 2026-07-02

- **Plan-first execution engine** (`plan-execute.ts`), relocated from the mcp so it's a shared engine primitive alongside `buildPlanGraph`. Pure (no SDK/network — deps injected): `executePlanParallel` (layer the DAG, run each layer concurrently, thread upstream results, isolate failures), `layerPlan`, `buildExecutionPlan`, `gatePlan`, `parseEntrySelection`, `defaultBuildDirective`, and the `NodeRun` / `PlanExecDeps` / `PlanExecResult` / `GateVerdict` / `RecordedCall` types. Exported from the engine entry. The mcp keeps the LLM-specific bits (`selectEntryTypes`, `enactNode`, the coordinator harness) and consumes these. 101 tests.

## 0.13.0 — 2026-07-01

- **The capability join lives here now — `capabilityWithRun` / `capabilitiesWithRun`** (STDIO-515). Recipes already owned a capability's DATA half (`parseCapability` → `CapabilityDescriptor`); the CODE half (a consumer's `run` executor, keyed by type) was joined to it in each consumer (aigency-web's `capabilities.ts`). That join is engine logic in the wrong place — and it must be **universally available to aigency AND the MCP**, which can't import aigency, so a shared lib is the only home. Lifted here: `capabilityWithRun<Run>(corpus, type, executors)` (single lookup) and `capabilitiesWithRun<Run>(corpus, executors)` (bulk), plus the `CapabilityWithRun<Run> = CapabilityDescriptor & { run?: Run }` type. **Generic over the executor signature** — recipes owns the join, not the executor shape, so each consumer plugs in its own (`run: undefined` for a conversation-only capability with no executor; `undefined` when no descriptor of that type exists). Consumers refactor to call it and drop their local copies.

## 0.12.0 — 2026-06-23

- **Recalibrate `ADVERSARIAL_REVIEW_SYSTEM_PROMPT` — fix cross-model over-rejection** (STDIO-461). A cross-model e2e (the verifier run as the reviewer across six SambaNova-served models) found the original "assume the work is wrong until it proves otherwise" + "untested behaviour" framing drove most models to manufacture blocking defects on genuinely-clean, fully-tested code — an infinite "you didn't test X" testing-completeness regress, or hallucinated concerns. As shipped, the gate would loop good work to its cap and report NOT approved on the very models we want to use. The prompt is reframed to "a rigorous reviewer with merge authority": block ONLY for a defect you would genuinely refuse to merge over (correctness, missed requirement, real-use failure path, security/data-safety, central behaviour left untested); do NOT block for speculative concerns, defensive checks the contract doesn't call for, style, or "more tests could exist" for out-of-contract inputs; if unsure, it is not blocking; correct, safe, contract-tested work must be APPROVED. The untrusted-data framing and first-line-`APPROVE` verdict contract (and so the pure `parseReviewVerdict`) are unchanged. After recalibration, the capable reasoning-tier candidates approve clean code AND reject a no-validation defect; the residual under-rejection seen on two models is a model-fitness matter (gated separately), not a prompt one. New tests guard the calibration against silent regression; the standing calibration suite that measures per-model fitness and detects drift lands separately.

## 0.11.0 — 2026-06-23

- **Adversarial review — the rubric arm of the verify spectrum** (STDIO-458). `@verevoir/recipes/engine` now exports `makeAdversarialReview(opts)`, a model-injected `Verifier` that runs an antagonistic PR-style review over produced output (code, design, prose) and blocks on any defect it would reject in review — the universal "antagonist on all generation" to sit beside the `deterministic` read-back gate.
  - **Provider-agnostic** by the engine's existing seam: the model call is an injected `ChatFn` (defaulting to the Anthropic adapter), so the review runs on DeepSeek / Mistral / a local model without recipes importing any SDK. Defaults to the `reasoning` tier (review is discrimination); takes an optional `rubric` (the bar to hold the work to) and `artefact` label.
  - **Fail-closed against an untrusted artefact**: the reviewed output is interpolated into the prompt, so it could carry a stray `APPROVE` or markdown bullets a weak model echoes back. The artefact is fenced with a per-call nonce and marked inert, and the verdict (`parseReviewVerdict`, pure + exported) is read only from the reviewer's FIRST line — a clean pass is a sole leading `APPROVE`, never a token found anywhere in the reply — so echoed content can neither forge a pass nor manufacture findings. An empty/garbled/off-format reply blocks too, carrying the reviewer's own words so the re-produce keeps signal; a non-string adapter reply fails closed rather than throwing. Empty output blocks without spending a model call. Composes straight into `runWithVerify` like any other `Verifier`.

## 0.10.0 — 2026-06-23

- **The shared verify engine — contract + runner** (STDIO-456). `@verevoir/recipes/engine` now exports the vocabulary and the loop that enforce a capability's `verify` postcondition, so aigency-web and the MCP bind one engine instead of each owning a copy.
  - **Contract**: `VerifyKind` (`deterministic | rubric | prose` — how conformance is judged), `VerifyFinding` / `VerifyResult` / `VerifyInput` / `Verifier`, and the pure helpers `isClean` (fail-closed across kinds — a rubric/prose fail carrying no structured findings still reads not-clean) and `formatFindings`.
  - **Runner**: `runWithVerify({ capability, verify, produce, verifier, maxAttempts })` → `{ result, attempts, converged, findings }` — the produce → verify → re-produce-with-findings loop. PURE of model + IO (`produce` and `verifier` are injected), so it is provider-agnostic and unit-testable with no network. Returns the outcome truthfully (the cross-model matrix wants the attempt count, not an exception); `enforceConverged` is the one-line fail-closed gate. The binary-gate sibling of the score-based refine loop.

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
