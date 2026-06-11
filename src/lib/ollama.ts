const OLLAMA_BASE = "http://localhost:11434";

export interface OllamaStatus {
  reachable: boolean;
  model: string | null;
  dimension: number;
}

/**
 * Check Ollama availability and find a suitable embedding model.
 */
export async function checkOllama(): Promise<OllamaStatus> {
  const models = await getOllamaModels();
  if (!models.length) {
    return { reachable: false, model: null, dimension: 0 };
  }

  // Prefer nomic-embed-text, then any model with "embed" in name
  const embedModels = models.filter(m =>
    m.includes("embed") || m.includes("nomic")
  );
  const model = embedModels.length > 0 ? (embedModels[0] ?? null) : null;

  // Known dimensions for common models
  const dimMap: Record<string, number> = {
    "nomic-embed-text": 768,
    "nomic-embed-text-v2": 768,
    "all-minilm": 384,
    "mxbai-embed-large": 1024,
  };

  const dimension = model ? (dimMap[model] ?? 768) : 0;

  return { reachable: true, model, dimension };
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map(m => m.name.replace(/:latest$/, ""));
  } catch {
    return [];
  }
}

/**
 * Embed single text or batch of texts using Ollama.
 */
export async function embedWithOllama(
  input: string | string[],
  model: string
): Promise<Float32Array | Float32Array[]> {
  const texts = Array.isArray(input) ? input : [input];

  const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama embed failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { embeddings: number[][] };

  if (Array.isArray(input)) {
    return data.embeddings.map(e => new Float32Array(e));
  }

  return new Float32Array(data.embeddings[0]!);
}
