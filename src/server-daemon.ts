// Daemon entry point — spawned by `codeview start`.
// Starts server, prints PORT:<number> to stdout, then runs forever.

import { startServer } from "./server";

const rootDir = process.argv[2] || process.cwd();

async function main() {
  const { port } = await startServer(rootDir, 0);
  // Signal the parent CLI process
  console.log(`PORT:${port}`);

  // Keep alive indefinitely
  process.stdin.resume();
}

main().catch(err => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
