import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import type { CodeviewConfig, GraphWalkConfig } from "./types";

export const defaultGraphWalk: GraphWalkConfig = {
  maxDepth: 1,
  maxNeighborsPerNode: 5,
  maxAugmentationTokens: 2000,
};

export const defaultConfig: CodeviewConfig = {
  tokenBudget: 5000,
  graphWalk: defaultGraphWalk,
};

/**
 * Load cvconfig.json from a directory, walking up to root if needed.
 * Falls back to defaults if no cvconfig.json found.
 */
export function loadConfig(rootDir: string): CodeviewConfig {
  let dir = resolve(rootDir);

  while (true) {
    const configPath = join(dir, "cvconfig.json");
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const userConfig = JSON.parse(raw) as Partial<CodeviewConfig>;
        return {
          ...defaultConfig,
          ...userConfig,
          graphWalk: {
            ...defaultGraphWalk,
            ...userConfig.graphWalk,
          },
        };
      } catch {
        // Invalid JSON — fall through to defaults
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return { ...defaultConfig, graphWalk: { ...defaultGraphWalk } };
}
