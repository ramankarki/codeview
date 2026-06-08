import type { EmbeddingConfig } from "../types";
import { checkOllama, embedWithOllama } from "./ollama";

export interface EmbeddingProvider {
  provider: "ollama" | "openai" | "voyage" | "degraded";
  reachable: boolean;
  dimension: number;
  model: string | null;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

/**
 * Create an embedding provider from config.
 * Falls back to degraded mode if the provider is unreachable.
 */
export async function createEmbeddingProvider(
  config: EmbeddingConfig
): Promise<EmbeddingProvider> {
  switch (config.provider) {
    case "ollama": {
      const status = await checkOllama();
      if (status.reachable && status.model) {
        return {
          provider: "ollama",
          reachable: true,
          dimension: status.dimension,
          model: status.model,
          embed: (text: string) => embedWithOllama(text, status.model!) as Promise<Float32Array>,
          embedBatch: (texts: string[]) =>
            embedWithOllama(texts, status.model!) as Promise<Float32Array[]>,
        };
      }
      return degradedProvider();
    }

    case "openai": {
      if (!config.apiKey) return degradedProvider();
      return {
        provider: "openai",
        reachable: true,
        dimension: 1536, // text-embedding-3-small
        model: config.model ?? "text-embedding-3-small",
        embed: (text: string) => embedRemote(text, config.apiKey!, config.model ?? "text-embedding-3-small", "https://api.openai.com/v1/embeddings"),
        embedBatch: (texts: string[]) => embedBatchRemote(texts, config.apiKey!, config.model ?? "text-embedding-3-small", "https://api.openai.com/v1/embeddings"),
      };
    }

    case "voyage": {
      if (!config.apiKey) return degradedProvider();
      return {
        provider: "voyage",
        reachable: true,
        dimension: 1024, // voyage-3-large default
        model: config.model ?? "voyage-3-large",
        embed: (text: string) => embedRemote(text, config.apiKey!, config.model ?? "voyage-3-large", "https://api.voyageai.com/v1/embeddings"),
        embedBatch: (texts: string[]) => embedBatchRemote(texts, config.apiKey!, config.model ?? "voyage-3-large", "https://api.voyageai.com/v1/embeddings"),
      };
    }

    default:
      return degradedProvider();
  }
}

function degradedProvider(): EmbeddingProvider {
  return {
    provider: "degraded",
    reachable: false,
    dimension: 0,
    model: null,
    embed: async () => new Float32Array(0),
    embedBatch: async () => [],
  };
}

async function embedRemote(
  text: string,
  apiKey: string,
  model: string,
  endpoint: string
): Promise<Float32Array> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
  });

  if (!res.ok) {
    throw new Error(`Embedding API failed: ${res.status}`);
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return new Float32Array(data.data[0].embedding);
}

async function embedBatchRemote(
  texts: string[],
  apiKey: string,
  model: string,
  endpoint: string
): Promise<Float32Array[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!res.ok) {
    throw new Error(`Embedding API failed: ${res.status}`);
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map(e => new Float32Array(e.embedding));
}
