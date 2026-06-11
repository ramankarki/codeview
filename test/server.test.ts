import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "path";

const FIXTURE_DIR = resolve("test/fixtures/tiny-project");
let port: number;
let baseUrl: string;

beforeAll(async () => {
  const serverModule = await import("../src/server");
  const result = await serverModule.startServer(FIXTURE_DIR, 0);
  port = result.port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  const serverModule = await import("../src/server");
  serverModule.stopServer();
});

describe("GET /health", () => {
  test("returns status with chunks count", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.chunks).toBe("number");
    expect(body.ollama).toBeDefined();
  });
});

describe("POST /repo-map", () => {
  test("returns repo map with type info", async () => {
    const res = await fetch(`${baseUrl}/repo-map`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBeDefined();
    expect(typeof body.tokenCount).toBe("number");
    expect(body.text).toContain("Repo map");
  });

});

describe("POST /search", () => {
  test("returns results for query (degraded or semantic)", async () => {
    const res = await fetch(`${baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "add numbers" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);
  });

});

describe("POST /context", () => {
  test("returns hybrid context with repoMap", async () => {
    const res = await fetch(`${baseUrl}/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "add two numbers" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repoMap).toBeDefined();
    expect(body.repoMap).toContain("Repo map");
    expect(body.semantic).toBeDefined();
    expect(Array.isArray(body.semantic)).toBe(true);
    expect(body.augmented).toBeDefined();
    expect(typeof body.degraded).toBe("boolean");
  });
});

describe("GET /find", () => {
  test("finds symbol by name", async () => {
    const res = await fetch(`${baseUrl}/find?name=add`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbols).toBeDefined();
    expect(body.symbols.length).toBeGreaterThanOrEqual(1);
    expect(body.symbols[0].name).toBe("add");
    expect(body.symbols[0].kind).toBe("function");
  });
});

describe("POST /rebuild", () => {
  test("rebuilds without error", async () => {
    const res = await fetch(`${baseUrl}/rebuild`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
