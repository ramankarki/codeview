import { resolve, join, dirname } from 'path';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from 'fs';
import { startServer, stopServer } from './server';
import { generateAgentInstructions } from './lib/agent-instructions';
import { c } from './lib/colors';

const USAGE = `${c.bold}codeview${c.reset} ${c.dim}— Local codebase intelligence server for coding agents${c.reset}

${c.dim}Usage:${c.reset} ${c.bold}codeview${c.reset} ${c.dim}<command>${c.reset} ${c.dim}[...flags]${c.reset} ${c.dim}[...args]${c.reset}

${c.bold}Commands:${c.reset}
  ${c.cyan}help${c.reset}                      ${c.dim}Show this help${c.reset}
  ${c.cyan}start${c.reset}                     ${c.dim}Start server (idempotent)${c.reset}
  ${c.cyan}stop${c.reset}                      ${c.dim}Stop server${c.reset}
  ${c.cyan}status${c.reset}                    ${c.dim}Show server status${c.reset}
  ${c.cyan}mem${c.reset} | ${c.cyan}memory${c.reset}              ${c.dim}Real-time memory usage${c.reset}
  ${c.cyan}repo-map${c.reset}                  ${c.dim}Print structural repo map${c.reset}
  ${c.cyan}find${c.reset} ${c.dim}<name>${c.reset}               ${c.dim}Find exact symbol location${c.reset}
  ${c.cyan}references${c.reset} ${c.dim}<name>${c.reset}         ${c.dim}Find all usages of a symbol${c.reset}
  ${c.cyan}search${c.reset} ${c.dim}<query>${c.reset}            ${c.dim}Semantic code search${c.reset}
  ${c.cyan}context${c.reset} ${c.dim}<task>${c.reset}            ${c.dim}Hybrid: map + semantic + graph walk${c.reset}
  ${c.cyan}rebuild${c.reset}                   ${c.dim}Drop DB, re-index from scratch${c.reset}
  ${c.cyan}init${c.reset}                      ${c.dim}Generate AGENTS.md at project root${c.reset}

${c.bold}Options:${c.reset}
  ${c.cyan}--root${c.reset} ${c.dim}<dir>${c.reset}   ${c.dim}Project root directory (default: cwd)${c.reset}

${c.bold}Examples:${c.reset}
  ${c.dim}$ ${c.reset}codeview start
  ${c.dim}$ ${c.reset}codeview context ${c.dim}"add Stripe webhook handler"${c.reset}
  ${c.dim}$ ${c.reset}codeview search ${c.dim}"rate limiting middleware"${c.reset}
  ${c.dim}$ ${c.reset}codeview find ${c.dim}createUser${c.reset}
  ${c.dim}$ ${c.reset}codeview init${c.reset}
`;

let serverPort: number | null = null;

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // Parse --root
  const rootIdx = args.indexOf('--root');
  const rootDir = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : process.cwd();

  // Hidden --daemon flag (internal, spawned by `codeview start`)
  if (cmd === '--daemon') {
    const daemonRoot = args[1] || process.cwd();
    const { port } = await startServer(daemonRoot, 0);
    console.log(`PORT:${port}`);
    process.stdin.resume(); // keep alive
    return;
  }

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  const portFile = join(rootDir, '.codeview', 'port');
  const pidFile = join(rootDir, '.codeview', 'pid');

  switch (cmd) {
    case 'start': {
      console.log(`${c.dim}Starting codeview...${c.reset}`);

      // Ensure .codeview dir exists
      const codeviewDir = join(rootDir, '.codeview');
      if (!existsSync(codeviewDir)) {
        mkdirSync(codeviewDir, { recursive: true });
      }

      // Check if already running via port file + health check
      const existingPort = readPortFile(portFile);
      if (existingPort && (await isServerRunning(existingPort))) {
        console.log(
          `${c.success}Already running on http://127.0.0.1:${existingPort}${c.reset}`,
        );
        process.exit(0);
      }

      // Clean stale files
      if (existingPort) {
        cleanupFiles(portFile, pidFile);
      }

      // Spawn daemon as detached child (this same script with --daemon flag)
      const selfScript = process.argv[1];
      const proc = Bun.spawn(['bun', 'run', selfScript, '--daemon', rootDir], {
        stdout: 'pipe',
        stderr: 'inherit',
      });

      // Read PORT:<number> from child stdout
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let port = 0;
      let output = '';

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
        console.log(`${c.success}Ready on http://127.0.0.1:${port}${c.reset}`);
        proc.unref(); // detach — daemon keeps running
      } else {
        console.error(`${c.error}Failed to start server${c.reset}`);
        proc.kill();
        process.exit(1);
      }

      process.exit(0);
      break;
    }

    case 'stop': {
      const pid = readPidFile(pidFile);
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {}
      } else {
        stopServer();
      }
      cleanupFiles(portFile, pidFile);
      console.log(`${c.success}Server stopped${c.reset}`);
      process.exit(0);
      break;
    }

    case 'status': {
      const port = readPortFile(portFile);
      if (!port || !(await isServerRunning(port))) {
        console.log(`${c.warn}Server not running${c.reset}`);
        console.log(`  Start with: ${c.cyan}codeview start${c.reset}`);
        process.exit(0);
      }

      const health = await fetch(`http://127.0.0.1:${port}/health`)
        .then((r) => r.json())
        .catch(() => null);

      if (!health) {
        console.log(
          `${c.warn}Server unreachable${c.reset} (port file exists but server not responding)`,
        );
        process.exit(0);
      }

      const pid = readPidFile(pidFile);
      const uptime = formatUptime(health.uptime || 0);
      const degraded = health.degraded
        ? ` ${c.yellow}[degraded — keyword only]${c.reset}`
        : '';
      const ollamaStatus = health.ollama
        ? `${c.success}connected${c.reset} (${health.embeddingModel || 'nomic-embed-text'}, ${health.embeddingDims || '?'}d)`
        : `${c.warn}unreachable${c.reset} — keyword search only`;

      console.log(
        `${c.label}Server:${c.reset}    http://127.0.0.1:${port} (pid: ${pid})${degraded}`,
      );
      console.log(`${c.label}Ollama:${c.reset}    ${ollamaStatus}`);
      console.log(`${c.label}Uptime:${c.reset}    ${uptime}`);
      console.log(`${c.label}Chunks:${c.reset}    ${health.chunks || 0}`);
      console.log(`${c.label}Projects:${c.reset}  ${health.projects || 0}`);
      console.log(`${c.label}Root:${c.reset}      ${rootDir}`);
      process.exit(0);
      break;
    }

    case 'repo-map': {
      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (!port) {
        console.error(
          `${c.error}Server not running. Run 'codeview start' first.${c.reset}`,
        );
        process.exit(1);
      }

      const res = await fetch(`http://127.0.0.1:${port}/repo-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      console.log(body.text);
      process.exit(0);
      break;
    }

    case 'find': {
      const name = args[1];
      if (!name) {
        console.error(`${c.error}Usage:${c.reset} codeview find <name>`);
        process.exit(1);
      }

      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (!port) {
        console.error(
          `${c.error}Server not running. Run 'codeview start' first.${c.reset}`,
        );
        process.exit(1);
      }

      const res = await fetch(
        `http://127.0.0.1:${port}/find?name=${encodeURIComponent(name)}`,
      );
      const body = await res.json();
      if (body.symbols?.length > 0) {
        for (const s of body.symbols) {
          console.log(
            `${c.cyan}${s.file}:${s.line}${c.reset}  ${c.bold}${s.kind} ${s.name}${c.reset}`,
          );
          console.log(`  ${c.dim}${s.signature}${c.reset}`);
        }
        console.log(`${c.dim}${body.symbols.length} match(es)${c.reset}`);
      } else {
        console.log(`${c.warn}No symbol found:${c.reset} ${name}`);
      }
      process.exit(0);
      break;
    }

    case 'references': {
      const name = args[1];
      if (!name) {
        console.error(`${c.error}Usage:${c.reset} codeview references <name>`);
        process.exit(1);
      }

      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (!port) {
        console.error(
          `${c.error}Server not running. Run 'codeview start' first.${c.reset}`,
        );
        process.exit(1);
      }

      const res = await fetch(
        `http://127.0.0.1:${port}/references?name=${encodeURIComponent(name)}`,
      );
      const body = await res.json();
      if (body.usages?.length > 0) {
        for (const u of body.usages) {
          console.log(
            `${c.cyan}${u.file}${c.reset} — ${c.dim}${u.context}${c.reset}`,
          );
        }
        console.log(`${c.dim}${body.usages.length} usage(s)${c.reset}`);
      } else {
        console.log(`${c.warn}No references found for:${c.reset} ${name}`);
      }
      process.exit(0);
      break;
    }

    case 'search': {
      const query = getQueryArgs(args, 1);
      if (!query) {
        console.error(`${c.error}Usage:${c.reset} codeview search <query>`);
        process.exit(1);
      }

      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (!port) {
        console.error(
          `${c.error}Server not running. Run 'codeview start' first.${c.reset}`,
        );
        process.exit(1);
      }

      const res = await fetch(`http://127.0.0.1:${port}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const body = await res.json();

      const degradedNote = body.degraded
        ? ` ${c.yellow}[degraded — keyword only]${c.reset}`
        : '';

      if (body.results?.length > 0) {
        console.log(
          `${c.bold}Search:${c.reset} "${query}" (${body.results.length} results${degradedNote})\n`,
        );
        for (let i = 0; i < body.results.length; i++) {
          const r = body.results[i];
          const distStr =
            r.distance != null ? `distance: ${r.distance.toFixed(3)}` : '';
          const fusionStr =
            r.fusionScore != null ? `fusion: ${r.fusionScore.toFixed(3)}` : '';
          const scoreStr = [distStr, fusionStr].filter(Boolean).join(', ');

          console.log(
            `${c.cyan}${i + 1}.${c.reset} ${r.file}:${r.startLine} — ${c.bold}${r.kind} ${r.signature}${c.reset} (${scoreStr})`,
          );

          // Show content preview if available
          if (r.content) {
            const preview = r.content.slice(0, 200).replace(/\n/g, ' ');
            console.log(
              `   ${c.dim}${preview}${r.content.length > 200 ? '...' : ''}${c.reset}`,
            );
          }
          console.log();
        }
      } else {
        console.log(
          `${c.bold}Search:${c.reset} "${query}" (0 results${degradedNote})`,
        );
        console.log(`${c.dim}No results found.${c.reset}`);
      }
      process.exit(0);
      break;
    }

    case 'context': {
      const task = getQueryArgs(args, 1);
      if (!task) {
        console.error(
          `${c.error}Usage:${c.reset} codeview context <task description>`,
        );
        process.exit(1);
      }

      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (!port) {
        console.error(
          `${c.error}Server not running. Run 'codeview start' first.${c.reset}`,
        );
        process.exit(1);
      }

      const res = await fetch(`http://127.0.0.1:${port}/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      });
      const body = await res.json();
      console.log(body.repoMap);
      if (body.semantic?.length > 0) {
        console.log(
          `\n${c.heading}## Semantic matches for "${task}"${c.reset}`,
        );
        for (const r of body.semantic) {
          const distStr =
            r.distance != null
              ? ` (${c.dim}dist:${c.reset} ${r.distance.toFixed(3)})`
              : '';
          console.log(
            `- ${c.cyan}${r.file}${c.reset}::${c.bold}${r.signature}${c.reset}${distStr}`,
          );
        }
      }
      if (body.augmented?.length > 0) {
        console.log(`\n${c.heading}## Related code (graph walk)${c.reset}`);
        for (const r of body.augmented) {
          console.log(
            `- ${c.cyan}${r.file}${c.reset} ${c.dim}[${r.signature}]${c.reset}`,
          );
        }
      }
      process.exit(0);
      break;
    }

    case 'init': {
      const codeviewDir = join(rootDir, '.codeview');
      if (!existsSync(codeviewDir)) {
        mkdirSync(codeviewDir, { recursive: true });
      }
      const agentsPath = join(codeviewDir, 'AGENTS.md');

      const newContent = generateAgentInstructions();
      writeFileSync(agentsPath, newContent);
      console.log(`${c.success}Generated .codeview/AGENTS.md${c.reset}`);
      console.log(`  ${c.dim}→ ${agentsPath}${c.reset}`);
      console.log(
        `  ${c.dim}Copy the section(s) you need into your project's AGENTS.md${c.reset}`,
      );
      process.exit(0);
      break;
    }

    case 'rebuild': {
      const port = await ensureServerRunning(rootDir, portFile, pidFile);
      if (port) {
        await fetch(`http://127.0.0.1:${port}/rebuild`, { method: 'POST' });
        console.log(`${c.success}Rebuild initiated${c.reset}`);
      } else {
        console.error(
          `${c.error}Server not running. Run 'codeview start' first.${c.reset}`,
        );
        process.exit(1);
      }
      process.exit(0);
      break;
    }

    case 'mem':
    case 'memory': {
      const pid = readPidFile(pidFile);
      const dbPath = join(rootDir, '.codeview', 'codeview.db');

      // Daemon memory (via ps)
      if (pid) {
        try {
          const proc = Bun.spawn(['ps', '-o', 'rss=', '-p', String(pid)], {
            stdout: 'pipe',
            stderr: 'pipe',
          });
          const out = await new Response(proc.stdout).text();
          const rssKB = parseInt(out.trim()) || 0;
          if (rssKB > 0) {
            console.log(`${c.heading}Daemon (pid: ${pid})${c.reset}`);
            console.log(`${c.label}RSS:${c.reset}  ${formatKB(rssKB)}`);
          }
        } catch {
          console.log(`${c.warn}Daemon not running${c.reset}`);
        }
      } else {
        console.log(`${c.warn}Daemon not running (no pid file)${c.reset}`);
      }

      // CLI process memory
      const cliMem = process.memoryUsage();
      console.log(`${c.heading}CLI (pid: ${process.pid})${c.reset}`);
      console.log(`${c.label}RSS:${c.reset}  ${formatBytes(cliMem.rss)}`);
      console.log(
        `${c.label}Heap:${c.reset} ${formatBytes(cliMem.heapUsed)} / ${formatBytes(cliMem.heapTotal)}`,
      );

      // Database file size
      if (existsSync(dbPath)) {
        const stat = Bun.file(dbPath);
        const size = await stat.size;
        console.log(`${c.heading}Database${c.reset}`);
        console.log(
          `${c.label}DB:${c.reset}    ${formatBytes(size)} ${c.dim}(${dbPath})${c.reset}`,
        );
      }

      // Ollama (if reachable)
      const port = readPortFile(portFile);
      if (port && (await isServerRunning(port))) {
        const health = await fetch(`http://127.0.0.1:${port}/health`)
          .then((r) => r.json())
          .catch(() => null);
        if (health?.embeddingDims) {
          // Rough estimate: dims × 4 bytes × chunk count
          const vecBytes = health.embeddingDims * 4 * (health.chunks || 0);
          console.log(
            `${c.label}Vec idx:${c.reset} ${formatBytes(vecBytes)} ${c.dim}(${health.embeddingDims}d × ${health.chunks} chunks)${c.reset}`,
          );
        }
      }

      console.log();
      console.log(`${c.dim}${'─'.repeat(40)}${c.reset}`);
      const totalRSS = (pid ? await getDaemonRSS(pid) : 0) + cliMem.rss;
      const label = pid
        ? `${c.dim}(daemon + CLI)${c.reset}`
        : `${c.dim}(CLI only)${c.reset}`;
      console.log(
        `${c.bold}Total RSS:${c.reset} ${formatBytes(totalRSS)} ${label}`,
      );

      process.exit(0);
      break;
    }

    default:
      console.error(`${c.error}Unknown command:${c.reset} ${cmd}`);
      console.log(`Run ${c.cyan}codeview help${c.reset} for usage.`);
      process.exit(1);
  }
}

// === Helpers ===

function readPortFile(path: string): number | null {
  try {
    return parseInt(readFileSync(path, 'utf-8').trim());
  } catch {
    return null;
  }
}

function readPidFile(path: string): number | null {
  try {
    return parseInt(readFileSync(path, 'utf-8').trim());
  } catch {
    return null;
  }
}

function cleanupFiles(portFile: string, pidFile: string) {
  try {
    unlinkSync(portFile);
  } catch {}
  try {
    unlinkSync(pidFile);
  } catch {}
}

async function isServerRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServerRunning(
  rootDir: string,
  portFile: string,
  pidFile: string,
): Promise<number | null> {
  const existingPort = readPortFile(portFile);
  if (existingPort && (await isServerRunning(existingPort))) {
    return existingPort;
  }

  // Auto-start
  console.log(`${c.dim}Starting codeview daemon...${c.reset}`);
  const { port } = await startServer(rootDir, 0);
  serverPort = port;

  const codeviewDir = join(rootDir, '.codeview');
  if (!existsSync(codeviewDir)) {
    mkdirSync(codeviewDir, { recursive: true });
  }
  writeFileSync(portFile, String(port));
  writeFileSync(pidFile, String(process.pid));

  console.log(`${c.success}Ready on http://127.0.0.1:${port}${c.reset}`);
  return port;
}

function getQueryArgs(args: string[], startIdx: number): string {
  const filtered = args.slice(startIdx).filter((a, i, arr) => {
    if (a === '--root') return false;
    if (i > 0 && arr[i - 1] === '--root') return false;
    return true;
  });
  return filtered.join(' ');
}

function formatKB(kb: number): string {
  return formatBytes(kb * 1024);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function getDaemonRSS(pid: number): Promise<number> {
  try {
    const proc = Bun.spawn(['ps', '-o', 'rss=', '-p', String(pid)], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const out = await new Response(proc.stdout).text();
    return (parseInt(out.trim()) || 0) * 1024;
  } catch {
    return 0;
  }
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

// === Run ===

main().catch((e) => {
  console.error(`${c.error}Fatal error:${c.reset}`, e);
  process.exit(1);
});
