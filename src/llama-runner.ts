import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, relative } from 'node:path';
import { type LlmError, type LlmProvider, createOpenAiCompatibleProvider } from './llm-provider.js';
import { type Result, err, isOk, ok } from './result.js';
import { PID_DIR, removePidFile, writePidFile } from './server-pids.js';
import type { ChatMessage, ModelInfo } from './types.js';

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
  writePid?: (pidFilePath: string, pid: number) => void;
  removePid?: (pidFilePath: string, expectedPid?: number) => void;
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
  const writePid = deps.writePid ?? writePidFile;
  const removePid = deps.removePid ?? removePidFile;

  return async (ggufPath: string): Promise<Result<RunningServer, LlmError>> => {
    let port: number;
    try {
      port = await pickPort();
    } catch (e) {
      return err({ code: 'model_load_failed', message: `Failed to pick port: ${(e as Error).message}` });
    }

    let child: ChildProcess;
    try {
      child = spawn('llama-server', ['-m', ggufPath, '--port', String(port), '--host', '127.0.0.1', '--no-webui']);
    } catch (e) {
      return err({ code: 'llama_not_found', message: `Failed to spawn llama-server: ${(e as Error).message}` });
    }

    const pidFilePath = join(PID_DIR, `${port}-llama.pid`);
    const spawnedPid = child.pid;
    if (spawnedPid !== undefined) {
      writePid(pidFilePath, spawnedPid);
      child.on('exit', () => removePid(pidFilePath, spawnedPid));
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

      child.on('exit', (code) => {
        if (resolved) return;
        resolved = true;
        resolve(err({ code: 'model_load_failed', message: `llama-server exited early with code ${code}` }));
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
                resolve(ok({ baseUrl, stop: () => { child.kill(); if (spawnedPid !== undefined) removePid(pidFilePath, spawnedPid); } }));
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
  ask(request: { model: string; messages: ChatMessage[] }): Promise<Result<string, LlmError>>;
  shutdown(): Promise<void>;
}

export interface LocalChatOptions {
  modelsDir: string;
  spawnServer?: (ggufPath: string) => Promise<Result<RunningServer, LlmError>>;
  providerFor?: (baseUrl: string) => LlmProvider;
}

export function createLocalChat(options: LocalChatOptions): LocalChat {
  const spawnServer = options.spawnServer ?? createLlamaSpawner();
  const providerFor =
    options.providerFor ??
    ((baseUrl: string) =>
      createOpenAiCompatibleProvider({
        baseUrl: `${baseUrl}/v1`,
        apiKey: 'sk-local',
        model: 'local',
      }));

  let current: { model: string; server: RunningServer } | null = null;
  let mutex: Promise<void> = Promise.resolve();

  async function ensure(model: string): Promise<Result<void, LlmError>> {
    if (current?.model === model) {
      return ok(undefined);
    }

    current?.server.stop();

    const ggufPath = join(options.modelsDir, model);
    const result = await spawnServer(ggufPath);
    if (!isOk(result)) {
      current = null;
      return result;
    }

    current = { model, server: result.value };
    return ok(undefined);
  }

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

    async ask(request) {
      return new Promise((resolve) => {
        mutex = mutex.then(async () => {
          try {
            const ensured = await ensure(request.model);
            if (!isOk(ensured)) {
              resolve(ensured);
              return;
            }
            const reply = await providerFor(current!.server.baseUrl).chat(request.messages);
            resolve(reply);
          } catch (e) {
            current = null;
            resolve(err({ code: 'request_failed', message: `ask failed: ${(e as Error).message}` }));
          }
        });
      });
    },

    async shutdown() {
      current?.server.stop();
      current = null;
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
