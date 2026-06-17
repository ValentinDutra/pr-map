import express, { type Express } from 'express';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openBrowser from 'open';
import { createGhClient, createDefaultExecutor, type GhClient } from './gh-client.js';
import {
  createReviewRouter,
  createFileReviewStore,
  type ReviewStore,
} from './review-endpoints.js';
import type { PrGraph } from './types.js';

const DEFAULT_PORT = 5598;
const DASHBOARD_DIST = fileURLToPath(new URL('../dashboard/dist', import.meta.url));

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
