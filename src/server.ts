import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openBrowser from 'open';
import { createAiRouter } from './ai-endpoints.js';
import { createGhClient, createDefaultExecutor, type GhClient } from './gh-client.js';
import { createLocalChat, type LocalChat } from './llama-runner.js';
import {
  createReviewRouter,
  createExistingRouter,
  createChecksRouter,
  createCommitsRouter,
  createThreadsRouter,
  createFileReviewStore,
  type ReviewStore,
} from './review-endpoints.js';
import type { PrGraph } from './types.js';

const DEFAULT_PORT = 5598;
// One PID file per server, named by port, under a shared directory — so concurrent dashboards
// (reviewing two PRs at once) don't clobber each other's PID. The SessionEnd cleanup hook kills
// every PID in this directory.
const PID_DIR = join(tmpdir(), 'pr-map-server-pids');

// Resolve the dashboard whether running bundled (pr-map-plugin/dist/server.js, dashboard at
// ../dashboard-dist) or from source in dev (src/server.js, dashboard at ../dashboard/dist).
function resolveDashboardDist(): string {
  for (const candidate of ['../dashboard-dist', '../dashboard/dist']) {
    const resolved = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(resolved)) return resolved;
  }
  return fileURLToPath(new URL('../dashboard/dist', import.meta.url));
}

const DASHBOARD_DIST = resolveDashboardDist();

export interface ServerDeps {
  dataDir: string;
  ghClient: GhClient;
  localChat: LocalChat;
  store: ReviewStore;
}

export function createApp(deps: ServerDeps): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/graph', async (_request, response) => {
    try {
      const raw = await readFile(join(deps.dataDir, 'graph.json'), 'utf8');
      response.type('application/json').send(raw);
    } catch {
      response.status(404).json({ error: 'graph.json not found' });
    }
  });

  app.use('/api/review', createReviewRouter({ ghClient: deps.ghClient, store: deps.store }));
  app.use('/api/existing', createExistingRouter({ ghClient: deps.ghClient, store: deps.store }));
  app.use('/api/checks', createChecksRouter({ ghClient: deps.ghClient, store: deps.store }));
  app.use('/api/commits', createCommitsRouter({ ghClient: deps.ghClient, store: deps.store }));
  app.use('/api/threads', createThreadsRouter({ ghClient: deps.ghClient, store: deps.store }));
  app.use('/api/ai', createAiRouter({ localChat: deps.localChat }));

  // Any unmatched /api/* path returns JSON 404 instead of falling through to the SPA HTML.
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use(express.static(DASHBOARD_DIST));
  app.get('*', (_request, response) => {
    response.sendFile(join(DASHBOARD_DIST, 'index.html'), (error) => {
      // A missing index.html (dashboard not built) would otherwise surface as an opaque
      // Express error; return a clear message instead.
      if (error && !response.headersSent) {
        response
          .status(500)
          .json({ error: 'Dashboard build not found. Run `npm run build:plugin`.' });
      }
    });
  });

  return app;
}

async function readPrNumber(dataDir: string): Promise<number> {
  try {
    const graph = JSON.parse(await readFile(join(dataDir, 'graph.json'), 'utf8')) as PrGraph;
    return graph.meta.number;
  } catch {
    return 0;
  }
}

function listen(app: Express, port: number): Promise<Server> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = app.listen(port, () => resolvePromise(server));
    server.on('error', (error) => rejectPromise(error));
  });
}

// Register handlers that stop accepting new connections, close the HTTP server, and exit 0
// when the parent process signals shutdown (e.g. the SessionEnd cleanup hook sends SIGTERM).
// A guard ensures the shutdown sequence runs only once even if multiple signals arrive.
function registerGracefulShutdown(server: Server, pidFile: string): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`pr-map dashboard shutting down (${signal})`);
    try {
      rmSync(pidFile, { force: true });
    } catch {
      // Best effort: the cleanup hook also removes stale PID files.
    }
    server.close(() => process.exit(0));
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => shutdown(signal));
  }
}

export async function startServer(
  dataDir: string,
  preferredPort = DEFAULT_PORT,
): Promise<number> {
  const prNumber = await readPrNumber(dataDir);
  const app = createApp({
    dataDir,
    ghClient: createGhClient(createDefaultExecutor()),
    localChat: createLocalChat({
      modelsDir: process.env.PRMAP_MODELS_DIR ?? join(homedir(), 'models'),
    }),
    store: createFileReviewStore(dataDir, prNumber),
  });

  let port = preferredPort;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const server = await listen(app, port);
      const pidFile = join(PID_DIR, `${port}.pid`);
      registerGracefulShutdown(server, pidFile);
      // Record the PID (one file per port) so the SessionEnd cleanup hook can find and kill it.
      try {
        mkdirSync(PID_DIR, { recursive: true });
        writeFileSync(pidFile, String(process.pid));
      } catch {
        // Non-fatal: cleanup hook just won't find a pid file.
      }
      const url = `http://localhost:${port}`;
      console.log(`pr-map dashboard ready at ${url}`);
      if (process.env.PRMAP_NO_OPEN !== '1') {
        await openBrowser(url).catch(() => undefined);
      }
      return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      throw error;
    }
  }
  throw new Error(`No free port found starting from ${preferredPort}`);
}

const dataDirArgument = process.argv[2];
if (dataDirArgument) {
  startServer(resolve(dataDirArgument)).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
