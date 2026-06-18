import express, { type Express } from 'express';
import { readFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openBrowser from 'open';
import { createGhClient, createDefaultExecutor, type GhClient } from './gh-client.js';
import {
  createReviewRouter,
  createExistingRouter,
  createFileReviewStore,
  type ReviewStore,
} from './review-endpoints.js';
import type { PrGraph } from './types.js';

const DEFAULT_PORT = 5598;
const PID_FILE = join(tmpdir(), 'pr-map-server.pid');

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

  // Any unmatched /api/* path returns JSON 404 instead of falling through to the SPA HTML.
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use(express.static(DASHBOARD_DIST));
  app.get('*', (_request, response) => {
    response.sendFile(join(DASHBOARD_DIST, 'index.html'));
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

function listen(app: Express, port: number): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = app.listen(port, () => resolvePromise());
    server.on('error', (error) => rejectPromise(error));
  });
}

export async function startServer(
  dataDir: string,
  preferredPort = DEFAULT_PORT,
): Promise<number> {
  const prNumber = await readPrNumber(dataDir);
  const app = createApp({
    dataDir,
    ghClient: createGhClient(createDefaultExecutor()),
    store: createFileReviewStore(dataDir, prNumber),
  });

  let port = preferredPort;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await listen(app, port);
      // Record the PID at a fixed path so the SessionEnd cleanup hook can find and kill it.
      try {
        writeFileSync(PID_FILE, String(process.pid));
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
