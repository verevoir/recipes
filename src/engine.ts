// Capability / practice engine — front-half (retrieval, planning, provisioning).
// Behind a subpath (`@verevoir/recipes/engine`) so parser-only consumers of the
// root `@verevoir/recipes` never load the model adapter (`@verevoir/llm/anthropic`)
// or its `@anthropic-ai/sdk` peer — only callers that actually run the engine do.
export * from './retrieval.js';
export * from './provisioning.js';
export * from './plan.js';
