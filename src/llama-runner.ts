import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, relative } from 'node:path';
import type { LlmError } from './llm-provider.js';
import { type Result, err, ok } from './result.js';
import type { ModelInfo } from './types.js';

export interface RunningServer {
  baseUrl: string;
  stop: () => void;
}

export interface LlamaSpawnerDeps {
  spawn?: typeof nodeSpawn;
  fetchFn?: typeof fetch;
  pickPort?: () => Promise<number>;
  readyTimeoutMs?: number;
  pollIntervalMs?: number;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get port')));
      }
    });
    server.on('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createLlamaSpawner(
  deps: LlamaSpawnerDeps = {},
): (ggufPath: string) => Promise<Result<RunningServer, LlmError>> {
  const spawn = deps.spawn ?? nodeSpawn;
  const fetchFn = deps.fetchFn ?? fetch;
  const pickPort = deps.pickPort ?? findFreePort;
  const readyTimeoutMs = deps.readyTimeoutMs ?? 60_000;
  const pollIntervalMs = deps.pollIntervalMs ?? 300;

  return async (ggufPath: string): Promise<Result<RunningServer, LlmError>> => {
    const port = await pickPort();

    let child: ChildProcess;
    try {
      child = spawn('llama-server', ['-m', ggufPath, '--port', String(port), '--host', '127.0.0.1', '--no-webui']);
    } catch (e) {
      return err({ code: 'llama_not_found', message: `Failed to spawn llama-server: ${(e as Error).message}` });
    }

    return new Promise((resolve) => {
      let resolved = false;

      child.on('error', (e: NodeJS.ErrnoException) => {
        if (resolved) return;
        resolved = true;
        if (e.code === 'ENOENT') {
          resolve(err({ code: 'llama_not_found', message: 'llama-server not found on PATH' }));
        } else {
          resolve(err({ code: 'model_load_failed', message: `llama-server error: ${e.message}` }));
        }
      });

      const baseUrl = `http://127.0.0.1:${port}`;
      const healthUrl = `${baseUrl}/health`;
      const startTime = Date.now();

      const pollHealth = async () => {
        while (!resolved && Date.now() - startTime < readyTimeoutMs) {
          try {
            const response = await fetchFn(healthUrl);
            if (response.ok) {
              const body = (await response.json()) as { status?: string };
              if (body.status === 'ok') {
                resolved = true;
                resolve(ok({ baseUrl, stop: () => child.kill() }));
                return;
              }
            }
          } catch {
            // Server not ready yet, continue polling
          }
          await sleep(pollIntervalMs);
        }

        if (!resolved) {
          resolved = true;
          child.kill();
          resolve(err({ code: 'model_load_failed', message: `llama-server did not become ready within ${readyTimeoutMs}ms` }));
        }
      };

      pollHealth();
    });
  };
}

export interface LocalChat {
  listModels(): Promise<Result<ModelInfo[], LlmError>>;
}

export function createLocalChat(options: { modelsDir: string }): LocalChat {
  return {
    async listModels() {
      try {
        const dirents = await readdir(options.modelsDir, { recursive: true, withFileTypes: true });
        const paths = dirents
          .filter((d) => d.isFile())
          .map((d) => join(d.parentPath, d.name));
        return ok(discoverModels(paths, options.modelsDir));
      } catch {
        return ok([]);
      }
    },
  };
}

export function discoverModels(ggufPaths: string[], modelsDir: string): ModelInfo[] {
  return ggufPaths
    .filter((p) => {
      const lower = p.toLowerCase();
      if (!lower.endsWith('.gguf')) return false;
      const name = basename(p).toLowerCase();
      if (name.startsWith('mmproj')) return false;
      return true;
    })
    .map((p) => {
      const id = relative(modelsDir, p);
      const parentDir = dirname(p);
      const isNested = parentDir !== modelsDir;
      const name = isNested ? basename(parentDir) : basename(p).replace(/\.gguf$/i, '');
      return { id, name, path: p };
    });
}
