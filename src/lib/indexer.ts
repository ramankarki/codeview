import type { Chunk } from "../types";
import type { EmbeddingProvider } from "./embedding";
import { insertChunk, insertEmbedding, markStale, getStaleChunks, getDb } from "../db";

/**
 * Index chunks into DB. If provider is reachable, also embed them.
 * Stale chunks are re-embedded on demand.
 */
export async function indexChunks(
  chunks: Chunk[],
  provider: EmbeddingProvider
): Promise<{ indexed: number; embedded: number; failed: number }> {
  let indexed = 0;
  let embedded = 0;
  let failed = 0;

  // Insert all chunks first
  const chunkIds: number[] = [];
  for (const chunk of chunks) {
    const id = insertChunk(chunk);
    chunkIds.push(id);
    indexed++;
  }

  // Embed if provider is reachable
  if (provider.reachable) {
    const texts = chunks.map(c => (c.signature || c.body).slice(0, 512));

    // Batch process in groups of 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batchTexts = texts.slice(i, i + BATCH_SIZE);
      const batchIds = chunkIds.slice(i, i + BATCH_SIZE);

      try {
        const embeddings = await retryBatch(() => provider.embedBatch(batchTexts), 3);

        for (let j = 0; j < embeddings.length; j++) {
          const chunkId = batchIds[j];
          const emb = embeddings[j];
          if (chunkId == null || emb == null) continue;
          try {
            insertEmbedding(chunkId, emb, provider.dimension);
            embedded++;
          } catch {
            // Mark as stale if embedding insert fails
            markStaleById(chunkId);
            failed++;
          }
        }
      } catch {
        // Batch failed — mark all as stale
        for (const id of batchIds) {
          markStaleById(id);
        }
        failed += batchTexts.length;
      }
    }
  }

  return { indexed, embedded, failed };
}

/**
 * Re-embed chunks marked as stale.
 */
export async function reEmbedStale(provider: EmbeddingProvider): Promise<number> {
  if (!provider.reachable) return 0;

  const staleChunks = getStaleChunks();
  if (staleChunks.length === 0) return 0;

  let reEmbedded = 0;
  const texts = staleChunks.map(c => (c.signature || c.body).slice(0, 512));

  const BATCH_SIZE = 50;
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batchTexts = texts.slice(i, i + BATCH_SIZE);
    const batchChunks = staleChunks.slice(i, i + BATCH_SIZE);

    try {
      const embeddings = await retryBatch(() => provider.embedBatch(batchTexts), 3);

      for (let j = 0; j < embeddings.length; j++) {
        const chunk = batchChunks[j];
        const emb = embeddings[j];
        if (!chunk || !emb) continue;
        try {
          insertEmbedding(chunk.id, emb, provider.dimension);
          // Clear stale flag after successful re-embed
          clearStaleFlag(chunk.id);
          reEmbedded++;
        } catch {}
      }
    } catch {}
  }

  return reEmbedded;
}

// === Helpers ===

async function retryBatch<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err as Error;
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
  throw lastErr;
}

function markStaleById(id: number): void {
  getDb().prepare("UPDATE chunks SET stale = 1 WHERE id = ?").run(id);
}

function clearStaleFlag(id: number): void {
  getDb().prepare("UPDATE chunks SET stale = 0 WHERE id = ?").run(id);
}
