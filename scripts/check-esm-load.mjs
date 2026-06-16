// Post-build ESM load smoke (STDIO-336). Imports each published entrypoint with
// real `node` (not vitest, which resolves against `src/`), so it catches what a
// consumer actually gets from `dist/`: a broken export map, a missing build
// artefact, or — the load-bearing check — an **engine symbol leaking into the
// parser root**. The root (`@verevoir/recipes`) must stay free of the engine so
// parser-only consumers never drag in `@verevoir/llm/anthropic` + its
// `@anthropic-ai/sdk` peer; that separation is the whole point of the `./engine`
// subpath, and a stray re-export from the root silently defeats it.
import assert from 'node:assert/strict';

const root = await import('../dist/index.js');
const engine = await import('../dist/engine.js');

// The parser root carries the descriptor format + parser...
for (const name of ['parseCapability', 'parseSkill', 'renderSkillPrompt', 'isReasoningSkill']) {
  assert.equal(typeof root[name], 'function', `parser root must export ${name}`);
}

// ...and NOT the engine surface. A leak here would pull the model adapter into
// every parser-only consumer.
for (const name of [
  'buildCapabilityIndex',
  'retrieveCapabilities',
  'provisionPractices',
  'planExecution',
]) {
  assert.ok(!(name in root), `engine symbol "${name}" leaked into the parser root`);
}

// The engine subpath carries the engine surface (and is allowed to load the
// model adapter).
for (const name of [
  'buildCapabilityIndex',
  'retrieveCapabilities',
  'provisionPractices',
  'planExecution',
]) {
  assert.equal(typeof engine[name], 'function', `engine must export ${name}`);
}

console.log('esm-load smoke: ok — parser root clean, engine complete');
