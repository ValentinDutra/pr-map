import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone, agent-agnostic pipeline: graph -> enrich (provider switch) -> merge -> dashboard.
// Any runtime that can run node (Codex, Gemini, or a human at a terminal) gets the full pr-map
// experience without Claude's subagents. Each stage is a sibling dist script run as a child
// process, so there are no shared-module side effects to coordinate.

const distDir = dirname(fileURLToPath(import.meta.url));

interface StageResult {
  code: number;
  stdout: string;
}

// Run a sibling dist script, streaming its output through while also capturing stdout so a
// stage's JSON result can be read back. The child inherits this process's env (the LLM provider
// switch) and stdin.
function runStage(script: string, args: string[]): Promise<StageResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(distDir, script), ...args], {
      env: process.env,
      stdio: ['inherit', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.on('error', () => resolvePromise({ code: 1, stdout }));
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout }));
  });
}

// The graph CLI prints a single JSON line; pull the dataDir out of it.
function readDataDir(stdout: string): string | null {
  const line = stdout
    .split('\n')
    .map((entry) => entry.trim())
    .reverse()
    .find((entry) => entry.startsWith('{') && entry.includes('"dataDir"'));
  if (!line) return null;
  try {
    return (JSON.parse(line) as { dataDir?: string }).dataDir ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const ref = process.argv[2] ?? '';
  const repoRoot = resolve(process.argv[3] ?? process.cwd());

  console.log('pr-map: building the static graph...');
  const graph = await runStage('cli.js', [ref, repoRoot]);
  if (graph.code !== 0) process.exit(graph.code);
  const dataDir = readDataDir(graph.stdout);
  if (!dataDir) {
    console.error('pr-map: could not determine the data directory from the graph step.');
    process.exit(1);
  }

  console.log('\npr-map: enriching with the configured LLM provider...');
  const enrich = await runStage('enrich.js', [dataDir]);
  if (enrich.code !== 0) {
    console.warn('pr-map: enrichment failed; opening the dashboard with the static graph only.');
  } else {
    console.log('pr-map: merging enrichment into the graph...');
    await runStage('merge.js', [dataDir]);
  }

  console.log('\npr-map: starting the dashboard...');
  // The server runs in the foreground; it exits when the session ends (the cleanup hook) or on
  // SIGINT. Inherit its exit code.
  const server = await runStage('server.js', [dataDir]);
  process.exit(server.code);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
