import { describe, test, expect } from "bun:test";
import { isOllamaRunning, getOllamaModels, embedWithOllama, checkOllama } from "../src/lib/ollama";

describe("checkOllama", () => {
  test("returns reachable boolean and model info", async () => {
    const result = await checkOllama();
    // Ollama may or may not be running locally — test handles both
    expect(typeof result.reachable).toBe("boolean");
    if (result.reachable) {
      expect(result.model).toBeDefined();
      expect(result.dimension).toBeGreaterThan(0);
    }
  });
});

describe("isOllamaRunning", () => {
  test("returns boolean without throwing", async () => {
    const running = await isOllamaRunning();
    expect(typeof running).toBe("boolean");
  });
});

describe("getOllamaModels", () => {
  test("returns array or empty without throwing", async () => {
    const models = await getOllamaModels();
    expect(Array.isArray(models)).toBe(true);
  });
});

describe("embedWithOllama", () => {
  test("returns embedding vector when ollama is available", async () => {
    const running = await isOllamaRunning();
    if (!running) {
      console.log("Ollama not running — skipping embedding test");
      return;
    }

    const result = await checkOllama();
    if (!result.reachable || !result.model) {
      console.log("Ollama model not available — skipping");
      return;
    }

    const embedding = await embedWithOllama("test text", result.model);
    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(result.dimension);
  });

  test("batches multiple texts", async () => {
    const running = await isOllamaRunning();
    if (!running) {
      console.log("Ollama not running — skipping batch test");
      return;
    }

    const result = await checkOllama();
    if (!result.reachable || !result.model) {
      console.log("Ollama model not available — skipping");
      return;
    }

    const embeddings = await embedWithOllama(["text one", "text two"], result.model);
    expect(Array.isArray(embeddings)).toBe(true);
    expect(embeddings.length).toBe(2);
    expect(embeddings[0]).toBeInstanceOf(Float32Array);
  });
});
