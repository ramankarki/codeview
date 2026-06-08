import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "path";
import { existsSync, readFileSync, rmSync } from "fs";

const FIXTURE_DIR = resolve("test/fixtures/tiny-project");
const PORT_FILE = resolve(FIXTURE_DIR, ".codeview/port");
const PID_FILE = resolve(FIXTURE_DIR, ".codeview/pid");

function cleanup() {
  try { rmSync(resolve(FIXTURE_DIR, ".codeview"), { recursive: true, force: true }); } catch {}
}

function readPort(): number | null {
  try { return parseInt(readFileSync(PORT_FILE, "utf-8").trim()); } catch { return null; }
}

async function getPort(): Promise<number> {
  // Wait up to 5 seconds for port file
  for (let i = 0; i < 50; i++) {
    const port = readPort();
    if (port) {
      // Verify it's responding
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        if (res.ok) return port;
      } catch {}
    }
    await Bun.sleep(100);
  }
  throw new Error("Server didn't start within 5 seconds");
}

let serverProc: ReturnType<typeof Bun.spawn> | null = null;

afterAll(() => {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
  cleanup();
});

describe("CLI", () => {
  test("codeview --help shows usage", async () => {
    const result = Bun.spawnSync(
      ["bun", "run", resolve("src/cli.ts"), "--help"],
      { stdout: "pipe", stderr: "pipe" }
    );
    expect(result.exitCode).toBe(0);
    const out = new TextDecoder().decode(result.stdout);
    expect(out).toContain("Usage");
  });

  test("codeview start launches server", async () => {
    cleanup();
    serverProc = Bun.spawn(
      ["bun", "run", resolve("src/cli.ts"), "start", "--root", FIXTURE_DIR],
      { stdout: "pipe", stderr: "pipe" }
    );

    const port = await getPort();
    expect(port).toBeGreaterThan(0);

    // Verify health endpoint
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });

  test("codeview repo-map prints map", async () => {
    // Server should already be running from previous test
    const port = readPort();
    if (!port) throw new Error("Server not running");

    const result = Bun.spawnSync(
      ["bun", "run", resolve("src/cli.ts"), "repo-map", "--root", FIXTURE_DIR],
      { stdout: "pipe", stderr: "pipe" }
    );
    const out = new TextDecoder().decode(result.stdout);
    expect(out).toContain("Repo map");
    expect(out).toContain("add");
  });

  test("codeview find add returns symbol", async () => {
    const result = Bun.spawnSync(
      ["bun", "run", resolve("src/cli.ts"), "find", "add", "--root", FIXTURE_DIR],
      { stdout: "pipe", stderr: "pipe" }
    );
    const out = new TextDecoder().decode(result.stdout);
    expect(out).toContain("add");
    expect(out).toContain("function");
  });
});
