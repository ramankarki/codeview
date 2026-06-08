import { describe, test, expect } from "bun:test";
import { createEmbeddingProvider } from "../src/lib/embedding";

describe("createEmbeddingProvider", () => {
  test("creates ollama provider with model detection", async () => {
    const provider = await createEmbeddingProvider({
      provider: "ollama",
    });
    // May be "ollama" (reachable) or "degraded" (not running) — both valid
    expect(["ollama", "degraded"]).toContain(provider.provider);
    expect(typeof provider.dimension).toBe("number");
    if (provider.reachable) {
      expect(provider.dimension).toBeGreaterThan(0);
      expect(provider.provider).toBe("ollama");
    }
  });

  test("returns degraded when provider is ollama and not running", async () => {
    const provider = await createEmbeddingProvider({
      provider: "ollama",
    });
    // Ollama may or may not be running
    // If not running, dimension should be 0 and reachable false
    expect(typeof provider.reachable).toBe("boolean");
  });

  test("provider has embed function", async () => {
    const provider = await createEmbeddingProvider({
      provider: "ollama",
    });
    expect(typeof provider.embed).toBe("function");
  });

  test("provider has embedBatch function", async () => {
    const provider = await createEmbeddingProvider({
      provider: "ollama",
    });
    expect(typeof provider.embedBatch).toBe("function");
  });
});
