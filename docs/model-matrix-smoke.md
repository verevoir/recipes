# Model matrix smoke test

A periodic, low-cost check that the **capability/practice mechanism is hooked and
behaves consistently across the model spectrum** — Anthropic, Google, Mistral,
SambaNova (Llama and DeepSeek), and whatever else we add.

It is a **smoke test of the mechanism, not a benchmark of the models.** It does
not judge which model is "better", and it is not a performance or quality test —
functional behaviour is tested at the appropriate places (unit/integration
tests, the plan-correctness matrix in `aigency-web/scripts/matrix.ts`). This test
answers one question: _does the same mechanism do roughly the same thing on every
provider, in every cell?_

## Why it exists

The framework's thesis is that the substrate — the capability and practice
corpus, retrieved and provisioned declaratively — runs across a wide range of
models, not just a single frontier one (ADR 012, "commodity weights, proprietary
substrate"). A claim like that should be _checked_, cheaply and repeatably,
rather than asserted. This is that check: run a couple of representative requests
through the mechanism on each provider and confirm every cell lights up.

## What each cell confirms

For every cell (provider × workload-shape) the runner exercises the two
provider-varying halves of the mechanism and confirms both fire:

1. **Practice provisioning on that provider.** `provisionPractices` runs its
   concern-tagging reasoning call _on the cell's own provider_ (the injectable
   `chat`, since 0.4.0). A non-empty practice set ⇒ the practice mechanism is
   hooked there.
2. **A tool-driven response with the provisioned frame.** `chatWithToolLoop`
   runs with the provisioned practices in the system prompt and two tools the
   worker is nudged to call. ≥1 tool call + a final answer ⇒ the provider can
   drive the tool loop that enactment depends on.

A cell **passes** when practices were provisioned _and_ a response came back.

## Dimensions

- **Providers / models:** the cheap tier of each provider, so the run stays
  cheap. A provider that hosts several models (SambaNova) contributes more than
  one cell (e.g. Llama-3.3-70B and DeepSeek-V3.2).
- **Workload shapes — two, one of each:**
  - **story-shaped** — surgical, narrow (one concern). Demands exclusion.
  - **prd-shaped** — breadth (many concerns). Rewards applying everything
    relevant.

  This mirrors ADR 012's tiering split (a floor model is a breadth machine: good
  at prd-shaped, weak at surgical). One of each shape is adequate for a smoke
  test.

## How to run

The runner lives in the host that has every provider SDK installed and the keys:
`aigency-web/scripts/matrix-smoke.ts`. It makes **real API calls** (small spend)
and is **gated behind the env keys** — never run in CI.

```bash
cd aigency-web
set -a; source .env.local 2>/dev/null; set +a   # provider keys
npx tsx scripts/matrix-smoke.ts
```

It streams a markdown row per cell as each completes, then a summary line.

## Example run — 2026-06-12

Cheap tier, brief outputs, two workloads (a soft-delete change = story; a new
web product = prd):

| provider       | model         | shape | practices | tool calls | responded | cost (USD) |
| -------------- | ------------- | ----- | --------- | ---------- | --------- | ---------- |
| anthropic      | Haiku         | story | 26        | 2          | ✓         | 0.0043     |
| mistral        | Mistral Small | story | 24        | 2          | ✓         | 0.0004     |
| samba/llama    | Llama-3.3-70B | story | 28        | 2          | ✓         | 0.0016     |
| samba/deepseek | DeepSeek-V3.2 | story | 24        | 2          | ✓         | 0.0020     |
| gemini         | Gemini Flash  | story | 39        | 2          | ✓         | 0.0000     |
| anthropic      | Haiku         | prd   | 46        | 2          | ✓         | 0.0050     |
| mistral        | Mistral Small | prd   | 46        | 2          | ✓         | 0.0005     |
| samba/llama    | Llama-3.3-70B | prd   | 40        | 2          | ✓         | 0.0017     |
| samba/deepseek | DeepSeek-V3.2 | prd   | 44        | 2          | ✓         | 0.0023     |
| gemini         | Gemini Flash  | prd   | 42        | 2          | ✓         | 0.0000     |

**10/10 cells provisioned practices and responded; the tool loop fired on all
five providers. Total spend ≈ $0.018.**

What it shows:

- **The mechanism is hooked on every provider** — provisioning fired and a
  response came back in all ten cells.
- **Tool-driven enactment works on all five providers** — the loop ran and the
  model invoked both tools in every cell (Anthropic, Gemini, Mistral, and both
  SambaNova-hosted models).
- **Behaviour is consistent, with the expected shape signal:** prd-shaped
  provisions _more_ practices than story-shaped in **every** provider (story
  24–39, prd 40–46). The breadth/surgical distinction is a property of the
  mechanism, not of any one provider.

## Scope and honest limits

So that this stands scrutiny, here is exactly what it does and does **not** claim:

- It is a **smoke test of hookup and consistency**, not a precision or quality
  benchmark. The practice counts are high because cheap-tier concern-tagging
  **over-includes** (high recall, low precision) — which is _expected_ and is
  itself ADR 012's tiering thesis ("the floor model is a breadth machine").
  Precision is a reasoning-tier concern and is measured elsewhere.
- **Cost shows `0` for Gemini.** All five providers are tool-capable (Gemini's
  function calling landed in `@verevoir/llm@0.13.0`); the `0.0000` cost is a
  cosmetic gap, not a missing call — the Google adapter registers labels but not
  yet a priced model **catalogue**, so `estimateCostUSD` has no rate for it. The
  tool loop genuinely ran (2 calls per cell); only the dollar figure is absent.
- The **full enactment path** (`enactInline`, with the live tool set, repo tools,
  skills) is exercised on Anthropic by the app's own tests. This matrix tests the
  _portable mechanism_ (provisioning + a tool loop with the frame), not that full
  path on every provider.
- Default model ids and pricing for hosted providers are verified against each
  provider's live catalogue at authoring time but drift; decisions key on
  `provider/family`, so a new point-release still normalises and prices.

## Cadence

An **occasional regression check** — run it after touching the engine, the
provider adapters, or the corpus's concern taxonomy, and any time the question
"does this still work across providers?" comes up. It is not part of CI (real
spend, external dependencies).
