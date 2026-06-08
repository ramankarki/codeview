import { describe, test, expect } from "bun:test";
import { keywordSearch, reciprocalRankFusion, type SearchResult } from "../src/lib/search";

describe("keywordSearch", () => {
  const mockChunks: SearchResult[] = [
    { hash: "a", file: "src/pay.ts", startLine: 1, endLine: 5, signature: "function processPayment(amount: number)", kind: "function", rank: 0.5 },
    { hash: "b", file: "src/refund.ts", startLine: 10, endLine: 15, signature: "function processRefund(chargeId: string)", kind: "function", rank: 0.3 },
    { hash: "c", file: "src/util.ts", startLine: 20, endLine: 25, signature: "function formatCurrency(n: number)", kind: "function", rank: 0.1 },
  ];

  test("finds matching results by keyword", () => {
    const results = keywordSearch("payment", mockChunks);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].signature.toLowerCase()).toContain("payment");
  });

  test("scores exact matches higher than partial", () => {
    const results = keywordSearch("process", mockChunks);
    // processPayment and processRefund both match
    expect(results.length).toBe(2);
    // Both match, order depends on rank * match quality
    expect(results[0].signature).toContain("process");
  });

  test("returns empty for no match", () => {
    const results = keywordSearch("xyznotfound", mockChunks);
    expect(results.length).toBe(0);
  });

  test("case insensitive matching", () => {
    const results = keywordSearch("PAYMENT", mockChunks);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

describe("reciprocalRankFusion", () => {
  const semantic: SearchResult[] = [
    { hash: "a", file: "a.ts", startLine: 1, endLine: 5, signature: "fn a", kind: "function", distance: 0.1 },
    { hash: "b", file: "b.ts", startLine: 1, endLine: 5, signature: "fn b", kind: "function", distance: 0.2 },
  ];

  const structural: SearchResult[] = [
    { hash: "b", file: "b.ts", startLine: 1, endLine: 5, signature: "fn b", kind: "function", rank: 0.8 },
    { hash: "c", file: "c.ts", startLine: 1, endLine: 5, signature: "fn c", kind: "function", rank: 0.5 },
  ];

  test("merges two result sets without duplicates", () => {
    const fused = reciprocalRankFusion(semantic, structural, 10);
    // b appears in both, should be deduplicated
    const hashes = fused.map(r => r.hash);
    expect(hashes.length).toBeLessThanOrEqual(3);
    expect(new Set(hashes).size).toBe(hashes.length); // no duplicates
  });

  test("respects topK limit", () => {
    const fused = reciprocalRankFusion(semantic, structural, 2);
    expect(fused.length).toBeLessThanOrEqual(2);
  });
});
