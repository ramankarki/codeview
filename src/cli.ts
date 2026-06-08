import { resolve, join, dirname } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { startServer, stopServer } from "./server";
import { generateAgentInstructions } from "./lib/agent-instructions";

const USAGE = `Usage: codeview <command> [options]

Commands:
  start         Start server (idempotent)
  stop          Stop server
  status        Show server status
  repo-map      Print structural repo map
  find <name>   Find exact symbol location
  references <name>  Find all usages of a symbol
  search <query>     Semantic code search
  context <task>     Hybrid: map + semantic + graph walk
  rebuild       Drop DB, re-index from scratch
  init          Generate AGENTS.md at project root
  --help        Show this help

Options:
  --root <dir>  Project root directory (default: cwd)
`;

let serverPort: number | null = null;

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // Parse --root
  const rootIdx = args.indexOf("--root");
  const rootDir = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : process.cwd();

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  const portFile = join(rootDir, ".codeview", "port");
  const pidFile = join(rootDir, ".codeview", "pid");

  switch (cmd) {
    case "start": {
      // Ensure .codeview dir exists
      const codeviewDir = join(rootDir, ".codeview");
      if (!existsSync(codeviewDir)) {
        mkdirSync(codeviewDir, { recursive: true });
      }

      // Check if already running via port file + health check
      const existingPort = readPortFile(portFile);
      if (existingPort && (await isServerRunning(existingPort))) {
        console.log(`✓ Already running on http://127.0.0.1:${existingPort}`);
        process.exit(0);
      }

      // Clean stale files
      if (existingPort) {
        cleanupFiles(portFile, pidFile);
      }

      // Spawn server daemon as detached child
      const daemonScript = resolve(import.meta.dir, "server-daemon.js");
      // Use .ts fallback during development
      const scriptPath = existsSync(daemonScript) ? daemonScript : resolve(import.meta.dir, "server-daemon.ts");
      const proc = Bun.spawn(
        ["bun", "run", scriptPath, rootDir],
        {
          stdout: "pipe",
          stderr: "inherit",
        }
      );

      // Read PORT:<number> from child stdout
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let port = 0;
      let output = "";

      // Wait up to 15 seconds for port signal
      const deadline = Date.now() + 15000;
      try {
        while (Date.now() < deadline) {
          const { done, value } = await reader.read();
          if (value) {
            output += decoder.decode(value, { stream: true });
            const match = output.match(/PORT:(\d+)/);
            if (match) {
              port = parseInt(match[1]);
              break;
            }
          }
          if (done) break;
        }
      } catch {}

      reader.releaseLock();

      if (port > 0) {
        // Wait a moment for port file to be written by the daemon
        await Bun.sleep(200);
        console.log(`✓ Ready on http://127.0.0.1:${port}`);
        proc.unref(); // detach — daemon keeps running
      } else {
        console.log("✗ Failed to start server");
        proc.kill();
        process.exit(1);
      }

      process.exit(0);
      break;
    }

    case "stop": {
      const pid = readPidFile(pidFile);
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      } else {
        stopServer();
      }
      cleanupFiles(portFile, pidFile);
      console.log("✓ Server stopped");
      process.exit(0);
      break;
    }

    case "status": {
      const port = readPortFile(portFile);
      if (port && (await isServerRunning(port))) {
        const health = await fetch(`http://127.0.0.1:${port}/health`)
          .then(r => r.json())
          .catch(() => null);
        if (health) {
          console.log(
            `Running on :${port} · ${health.chunks} chunks · Ollama ${health.ollama ? "✓" : "✗"}`
          );
        } else {
          console.log(`Running on :${port} (health check failed)`);
        }
      } else {
        console.log("Not running");
      }
      process.exit(0);
      break;
    }

    case "repo-map": {
      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (!port) {
        console.log("✗ Server not running. Run 'codeview start' first.");
        process.exit(1);
      }

      const res = await fetch(`http://127.0.0.1:${port}/repo-map`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      console.log(body.text);
      process.exit(0);
      break;
    }

    case "find": {
      const name = args[1];
      if (!name) {
        console.log("Usage: codeview find <name>");
        process.exit(1);
      }

      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (!port) {
        console.log("✗ Server not running. Run 'codeview start' first.");
        process.exit(1);
      }

      const res = await fetch(
        `http://127.0.0.1:${port}/find?name=${encodeURIComponent(name)}`
      );
      const body = await res.json();
      if (body.symbols?.length > 0) {
        for (const s of body.symbols) {
          console.log(`${s.file}:${s.line}  ${s.kind} ${s.name}`);
          console.log(`  ${s.signature}`);
        }
      } else {
        console.log(`No symbol found: ${name}`);
      }
      process.exit(0);
      break;
    }

    case "references": {
      const name = args[1];
      if (!name) {
        console.log("Usage: codeview references <name>");
        process.exit(1);
      }

      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (!port) {
        console.log("✗ Server not running. Run 'codeview start' first.");
        process.exit(1);
      }

      const res = await fetch(
        `http://127.0.0.1:${port}/references?name=${encodeURIComponent(name)}`
      );
      const body = await res.json();
      if (body.usages?.length > 0) {
        for (const u of body.usages) {
          console.log(`${u.file} — ${u.context}`);
        }
      } else {
        console.log(`No references found for: ${name}`);
      }
      process.exit(0);
      break;
    }

    case "search": {
      const query = getQueryArgs(args, 1);
      if (!query) {
        console.log("Usage: codeview search <query>");
        process.exit(1);
      }

      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (!port) {
        console.log("✗ Server not running. Run 'codeview start' first.");
        process.exit(1);
      }

      const res = await fetch(`http://127.0.0.1:${port}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const body = await res.json();
      if (body.results?.length > 0) {
        for (const r of body.results) {
          const distStr = r.distance != null ? ` (dist: ${r.distance.toFixed(3)})` : "";
          console.log(`${r.file}:${r.startLine}  ${r.kind} ${r.signature}${distStr}`);
        }
      } else {
        console.log("No results found.");
      }
      process.exit(0);
      break;
    }

    case "context": {
      const task = getQueryArgs(args, 1);
      if (!task) {
        console.log("Usage: codeview context <task description>");
        process.exit(1);
      }

      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (!port) {
        console.log("✗ Server not running. Run 'codeview start' first.");
        process.exit(1);
      }

      const res = await fetch(`http://127.0.0.1:${port}/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const body = await res.json();
      console.log(body.repoMap);
      if (body.semantic?.length > 0) {
        console.log(`\n## Semantic matches for "${task}"`);
        for (const r of body.semantic) {
          const distStr = r.distance != null ? ` (dist: ${r.distance.toFixed(3)})` : "";
          console.log(`- ${r.file}::${r.signature}${distStr}`);
        }
      }
      if (body.augmented?.length > 0) {
        console.log("\n## Related code (graph walk)");
        for (const r of body.augmented) {
          console.log(`- ${r.file} [${r.signature}]`);
        }
      }
      process.exit(0);
      break;
    }

    case "init": {
      const codeviewDir = join(rootDir, ".codeview");
      if (!existsSync(codeviewDir)) {
        mkdirSync(codeviewDir, { recursive: true });
      }
      const agentsPath = join(codeviewDir, "AGENTS.md");

      const newContent = generateAgentInstructions();
      writeFileSync(agentsPath, newContent);
      console.log("✓ Generated .codeview/AGENTS.md");
      console.log(`  → ${agentsPath}`);
      console.log("  Copy the section(s) you need into your project's AGENTS.md");
      process.exit(0);
      break;
    }

    case "rebuild": {
      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (port) {
        await fetch(`http://127.0.0.1:${port}/rebuild`, { method: "POST" });
        console.log("✓ Rebuild initiated");
      }
      process.exit(0);
      break;
    }

    default:
      console.log(`Unknown command: ${cmd}`);
      console.log(USAGE);
      process.exit(1);
  }
}

// === Helpers ===

function readPortFile(path: string): number | null {
  try {
    return parseInt(readFileSync(path, "utf-8").trim());
  } catch {
    return null;
  }
}

function readPidFile(path: string): number | null {
  try {
    return parseInt(readFileSync(path, "utf-8").trim());
  } catch {
    return null;
  }
}

function cleanupFiles(portFile: string, pidFile: string) {
  try { unlinkSync(portFile); } catch {}
  try { unlinkSync(pidFile); } catch {}
}

async function isServerRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServerRunning(
  rootDir: string,
  portFile: string,
  pidFile: string
): Promise<number | null> {
  const existingPort = readPortFile(portFile);
  if (existingPort && (await isServerRunning(existingPort))) {
    return existingPort;
  }

  // Auto-start: start server in this process, then return port
  // But we need to do this in a way that doesn't block the calling command.
  // For now, just try starting and reading port file.
  const { port } = await startServer(rootDir, 0);
  serverPort = port;

  const codeviewDir = join(rootDir, ".codeview");
  if (!existsSync(codeviewDir)) {
    mkdirSync(codeviewDir, { recursive: true });
  }
  writeFileSync(portFile, String(port));
  writeFileSync(pidFile, String(process.pid));

  return port;
}

function getQueryArgs(args: string[], startIdx: number): string {
  const filtered = args.slice(startIdx).filter((a, i, arr) => {
    if (a === "--root") return false;
    if (i > 0 && arr[i - 1] === "--root") return false;
    return true;
  });
  return filtered.join(" ");
}

main();
