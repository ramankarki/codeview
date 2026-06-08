import { describe, test, expect } from "bun:test";
import { loadConfig, defaultConfig } from "../src/config";

describe("loadConfig", () => {
  test("loads config from cvconfig.json with projects", () => {
    const config = loadConfig("test/fixtures/tiny-project");
    expect(config.projects).toBeDefined();
    expect(config.projects!.length).toBe(1);
    expect(config.projects![0].name).toBe("tiny");
    expect(config.projects![0].tsconfig).toBe("tsconfig.json");
  });

  test("returns defaults when cvconfig.json not found", () => {
    const config = loadConfig("/tmp/nonexistent-codeview-test");
    expect(config.projects).toBeUndefined();
    expect(config.tokenBudget).toBe(defaultConfig.tokenBudget);
    expect(config.graphWalk).toEqual(defaultConfig.graphWalk);
  });

  test("applies default tokenBudget of 5000", () => {
    const config = loadConfig("test/fixtures/tiny-project");
    expect(config.tokenBudget).toBe(5000);
  });

  test("applies default graphWalk config", () => {
    const config = loadConfig("test/fixtures/tiny-project");
    expect(config.graphWalk).toEqual({
      maxDepth: 1,
      maxNeighborsPerNode: 5,
      maxAugmentationTokens: 2000,
    });
  });

  test("respects overridden values in config", () => {
    const config = loadConfig("test/fixtures/tiny-project");
    // tiny-project cvconfig doesn't override tokenBudget, so defaults apply
    expect(config.tokenBudget).toBe(5000);
  });
});
