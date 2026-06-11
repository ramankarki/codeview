export interface SearchResult {
  hash: string;
  file: string;
  startLine: number;
  endLine: number;
  signature: string;
  kind: string;
  distance?: number;
  rank?: number;
  rrfScore?: number;
}

/**
 * Keyword-based structural search.
 * Tokenizes query, matches against signatures, scores by Jaccard similarity × PageRank.
 */
export function keywordSearch(query: string, candidates: SearchResult[]): SearchResult[] {
  const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
  if (queryTokens.length === 0) return [];

  const scored: SearchResult[] = [];

  for (const c of candidates) {
    const sigTokens = (c.signature + " " + c.kind).toLowerCase().split(/\W+/).filter(t => t.length >= 2);

    // Jaccard similarity
    const intersection = queryTokens.filter(t =>
      sigTokens.some(s => s.length >= 2 && (s.includes(t) || t.includes(s)))
    );
    const union = new Set([...queryTokens, ...sigTokens]);
    const jaccard = intersection.length / union.size;

    // Multiply by chunk rank
    const score = jaccard * (c.rank ?? 0.1);

    if (score > 0) {
      scored.push({ ...c, rank: score });
    }
  }

  scored.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  return scored.slice(0, 30); // top 30
}

/**
 * Reciprocal Rank Fusion.
 * RRF(score) = Σ 1/(60 + rank_i)
 */
export function reciprocalRankFusion(
  semantic: SearchResult[],
  structural: SearchResult[],
  topK: number
): SearchResult[] {
  const k = 60;
  const scoreMap = new Map<string, { result: SearchResult; score: number }>();

  // Score semantic results (rank 1 = best)
  for (let i = 0; i < semantic.length; i++) {
    const r = semantic[i]!;
    const score = 1 / (k + i + 1);
    scoreMap.set(r.hash, { result: { ...r, rrfScore: score }, score });
  }

  // Add structural scores
  for (let i = 0; i < structural.length; i++) {
    const r = structural[i]!;
    const score = 1 / (k + i + 1);
    const existing = scoreMap.get(r.hash);
    if (existing) {
      existing.score += score;
      existing.result.rrfScore = existing.score;
    } else {
      scoreMap.set(r.hash, { result: { ...r, rrfScore: score }, score });
    }
  }

  // Sort by RRF score descending
  const fused = [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(e => e.result);

  return fused;
}
