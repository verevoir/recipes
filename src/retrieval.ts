// CAPABILITY RETRIEVAL — the high-recall coarse retriever of the capability
// pipeline (stage 1). Given request prose, it ranks the capability corpus by
// semantic similarity and hands the top-K capability `type`s to the downstream
// model. No LLM in the retriever itself: a local, in-process sentence embedder
// turns each capability's ADDRESSING TEXT into a vector once (cached), and the
// request prose into a vector at retrieve time; cosine ranks the catalogue.
//
// This promotes the proven eval embedder (eval/capability-nav/embed-bin.ts,
// recall@20 = 85% over ~150 capabilities) into production, behind a pluggable
// `Embedder` so the local model can later be swapped for a hosted one without
// touching callers.
//
// The heavy local embedder impl (@huggingface/transformers) is NOT in this
// module — it must stay in the host and be injected. The host builds the index
// with its embedder and passes the index's `.retrieve()` to the planner.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CapabilityDescriptor } from './index.js';

const CACHE_DIR = join(process.cwd(), '.cache');

/**
 * A text→vectors embedder. The retriever depends only on this surface, so the
 * local bge model can be swapped for a hosted embedder later without touching
 * callers. `id` participates in the cache key, so swapping models (or model
 * versions) invalidates persisted vectors automatically.
 */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  readonly id: string;
}

/** Strip inline markdown markers (bold/italic/code) and collapse whitespace. */
function stripMd(s: string): string {
  return s.replace(/\*\*/g, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
}

/** The first paragraph of a capability's guidance body (blank-line delimited),
 * markdown-stripped. Empty when the body is empty. */
function firstParagraph(body: string): string {
  const trimmed = (body ?? '').trim();
  if (!trimmed) return '';
  const para = trimmed.split(/\n\s*\n/, 1)[0];
  return stripMd(para);
}

/**
 * The text the embedder indexes a capability by: its request-side addressing
 * (`description ?? postcondition`) plus the first paragraph of the guidance
 * body, which carries concrete request vocabulary the one-liner lacks. Mirrors
 * the eval's baseline addressing (description/postcondition) augmented with the
 * body lede.
 */
export function addressingText(c: CapabilityDescriptor): string {
  const parts: string[] = [];
  const lead = c.description ?? c.postcondition ?? '';
  if (lead) parts.push(stripMd(lead));
  const para = firstParagraph(c.guidance);
  if (para) parts.push(para);
  return parts.join(' ');
}

/** Cosine similarity. Vectors are L2-normalised, so this is a dot product. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** A built, queryable capability index: the embedder plus one vector per
 * capability type, ready for cosine ranking. */
export interface CapabilityIndex {
  embedder: Embedder;
  types: string[];
  vectors: Map<string, number[]>;
  /** retrieve(prose, k): embed the prose, cosine vs every capability vector,
   * return the top-k capability `type`s ranked by descending score. */
  retrieve(prose: string, k?: number): Promise<RetrievedCapability[]>;
}

export interface RetrievedCapability {
  type: string;
  score: number;
}

/** Generous default — slice 1's job is high recall; the downstream model
 * narrows. Matches the eval's K=20 recall@20 operating point. */
export const DEFAULT_K = 20;

/** sha256 over the (type → addressing text) map, sorted by type. A corpus edit
 * (new capability, changed description/body) changes the hash and invalidates
 * the persisted cache. */
function corpusSignature(addressing: Map<string, string>): string {
  const h = createHash('sha256');
  for (const type of [...addressing.keys()].sort()) {
    h.update(type);
    h.update(' ');
    h.update(addressing.get(type)!);
    h.update(' ');
  }
  return h.digest('hex');
}

interface DiskCache {
  embedderId: string;
  signature: string;
  vectors: Record<string, number[]>;
}

function cachePathFor(embedderId: string, signature: string): string {
  // The hash already binds embedder + corpus; a short prefix keeps the
  // filename readable. Slashes in a model id (e.g. Xenova/bge-...) would break
  // the path, so derive the whole name from the signature hash.
  const key = createHash('sha256')
    .update(embedderId)
    .update(' ')
    .update(signature)
    .digest('hex')
    .slice(0, 32);
  return join(CACHE_DIR, `capability-embeddings-${key}.json`);
}

function readDiskCache(
  path: string,
  embedderId: string,
  signature: string,
  types: string[]
): Map<string, number[]> | null {
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as DiskCache;
    if (cached.embedderId !== embedderId || cached.signature !== signature) {
      return null;
    }
    const vectors = new Map<string, number[]>();
    for (const type of types) {
      const v = cached.vectors[type];
      if (!v) return null; // partial cache — re-embed rather than serve gaps
      vectors.set(type, v);
    }
    return vectors;
  } catch {
    return null; // unreadable/corrupt — re-embed
  }
}

function writeDiskCache(
  path: string,
  embedderId: string,
  signature: string,
  vectors: Map<string, number[]>
): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const payload: DiskCache = {
      embedderId,
      signature,
      vectors: Object.fromEntries(vectors),
    };
    writeFileSync(path, JSON.stringify(payload));
  } catch (err) {
    // A cache that can't be written (read-only FS, etc.) must not break
    // retrieval — the in-memory index still works for the process lifetime.
    console.error(
      `capability-retrieval: failed to persist embedding cache — ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

// In-memory index cache, keyed by `embedderId + signature`. A cold start is a
// disk read; a warm process is a map hit (no disk, no re-embed).
const memo = new Map<string, CapabilityIndex>();

function makeIndex(
  embedder: Embedder,
  types: string[],
  vectors: Map<string, number[]>
): CapabilityIndex {
  return {
    embedder,
    types,
    vectors,
    async retrieve(prose: string, k = DEFAULT_K): Promise<RetrievedCapability[]> {
      const [qvec] = await embedder.embed([prose]);
      if (!qvec) return [];
      const scored = types.map((type) => ({
        type,
        score: cosine(qvec, vectors.get(type)!),
      }));
      scored.sort((a, b) => b.score - a.score);
      return k >= 0 ? scored.slice(0, k) : scored;
    },
  };
}

/**
 * Build a queryable index over a capability corpus. Embeds every capability's
 * addressing text once, caching the vectors:
 *   - in-memory, keyed by `embedder.id + sha256(addressing texts)` — a warm
 *     process never re-embeds or touches disk;
 *   - on disk under `.cache/capability-embeddings-<hash>.json` (gitignored) —
 *     a cold start is a disk read, not a re-embed.
 * The caller supplies the embedder — recipes does not bundle one.
 */
export async function buildCapabilityIndex(
  corpus: CapabilityDescriptor[],
  embedder: Embedder
): Promise<CapabilityIndex> {
  // Deterministic order: sort by type so the signature + vector layout are
  // stable across loads.
  const sorted = [...corpus].sort((a, b) => a.type.localeCompare(b.type));
  const types = sorted.map((c) => c.type);
  const addressing = new Map(sorted.map((c) => [c.type, addressingText(c)]));
  const signature = corpusSignature(addressing);

  const memoKey = `${embedder.id} ${signature}`;
  const hit = memo.get(memoKey);
  if (hit) return hit;

  const path = cachePathFor(embedder.id, signature);
  let vectors = readDiskCache(path, embedder.id, signature, types);

  if (!vectors) {
    const texts = types.map((t) => addressing.get(t)!);
    const embedded = await embedder.embed(texts);
    vectors = new Map<string, number[]>();
    types.forEach((t, i) => vectors!.set(t, embedded[i]));
    writeDiskCache(path, embedder.id, signature, vectors);
  }

  const index = makeIndex(embedder, types, vectors);
  memo.set(memoKey, index);
  return index;
}

/** Test seam: drop the in-memory index cache so a test can rebuild with a
 * different embedder/corpus. Does not touch the disk cache. */
export function clearCapabilityIndexCache(): void {
  memo.clear();
}
