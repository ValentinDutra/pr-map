import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { type LlmError, type LlmProvider, createOpenAiCompatibleProvider } from './llm-provider.js';
import { type Result, err, isOk, ok } from './result.js';
import {
  PID_DIR,
  type ServerRegistryEntry,
  listServerRegistry,
  removeServerRegistry,
  writeServerRegistry,
} from './server-pids.js';
import type { ChatMessage, ModelInfo } from './types.js';

export interface RunningServer {
  baseUrl: string;
  stop: () => void;
  onExit?: (cb: () => void) => void;
  pid?: number;
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
    let port: number;
    try {
      port = await pickPort();
    } catch (e) {
      return err({ code: 'model_load_failed', message: `Failed to pick port: ${(e as Error).message}` });
    }

    let child: ChildProcess;
    try {
      child = spawn('llama-server', ['-m', ggufPath, '--port', String(port), '--host', '127.0.0.1', '--no-webui'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch (e) {
      return err({ code: 'llama_not_found', message: `Failed to spawn llama-server: ${(e as Error).message}` });
    }

    const spawnedPid = child.pid;

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
                resolve(ok({
                  baseUrl,
                  pid: spawnedPid,
                  stop: () => { child.kill(); },
                  onExit: (cb) => { child.on('exit', () => cb()); },
                }));
                return;
              }
            }
          } catch {
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
  prewarm(model: string): Promise<Result<void, LlmError>>;
  shutdown(): Promise<void>;
  isReady(model?: string): boolean;
}

export interface LocalChatOptions {
  modelsDir: string;
  spawnServer?: (ggufPath: string) => Promise<Result<RunningServer, LlmError>>;
  providerFor?: (baseUrl: string) => LlmProvider;
  listRegistry?: () => ServerRegistryEntry[];
  writeRegistry?: (entry: ServerRegistryEntry) => void;
  removeRegistry?: (port: number) => void;
  probe?: (healthUrl: string) => Promise<boolean>;
  killPid?: (pid: number) => void;
  env?: NodeJS.ProcessEnv;
}

function portFromBaseUrl(baseUrl: string): number | undefined {
  const parsed = Number.parseInt(new URL(baseUrl).port, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
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
  const listRegistry = options.listRegistry ?? (() => listServerRegistry(PID_DIR));
  const writeRegistry =
    options.writeRegistry ??
    ((entry: ServerRegistryEntry) => writeServerRegistry(join(PID_DIR, `${entry.port}-llama.json`), entry));
  const removeRegistry =
    options.removeRegistry ?? ((port: number) => removeServerRegistry(join(PID_DIR, `${port}-llama.json`)));
  const probe =
    options.probe ??
    (async (healthUrl: string) => {
      try {
        const response = await fetch(healthUrl);
        if (!response.ok) return false;
        const body = (await response.json()) as { status?: string };
        return body.status === 'ok';
      } catch {
        return false;
      }
    });
  const killPid =
    options.killPid ??
    ((pid: number) => {
      try {
        process.kill(pid);
      } catch {
      }
    });
  const env = options.env ?? process.env;
  const keepAlive = () => env.PRMAP_KEEP_MODEL !== '0';

  let current: { model: string; server: RunningServer; adopted: boolean } | null = null;
  let mutex: Promise<void> = Promise.resolve();
  let shuttingDown = false;

  function register(server: RunningServer, model: string): void {
    const port = portFromBaseUrl(server.baseUrl);
    if (server.pid !== undefined && port !== undefined) {
      writeRegistry({ pid: server.pid, port, model });
    }
  }

  function releaseRegistration(server: RunningServer): void {
    const port = portFromBaseUrl(server.baseUrl);
    if (port !== undefined) {
      removeRegistry(port);
    }
  }

  async function ensure(model: string): Promise<Result<void, LlmError>> {
    if (shuttingDown) {
      return err({ code: 'model_load_failed', message: 'local chat is shutting down' });
    }

    if (current?.model === model) {
      if (!current.adopted) {
        return ok(undefined);
      }
      if (await probe(`${current.server.baseUrl}/health`)) {
        return ok(undefined);
      }
      releaseRegistration(current.server);
      current = null;
    }

    const resolvedDir = resolve(options.modelsDir);
    const resolvedModel = resolve(resolvedDir, model);
    if (isAbsolute(model) || !resolvedModel.startsWith(resolvedDir + sep)) {
      return err({ code: 'model_load_failed', message: `Model "${model}" resolves outside the models directory` });
    }

    current?.server.stop();
    current = null;

    for (const entry of listRegistry()) {
      if (current === null && entry.model === model && (await probe(`http://127.0.0.1:${entry.port}/health`))) {
        const { pid, port } = entry;
        current = {
          model,
          adopted: true,
          server: {
            baseUrl: `http://127.0.0.1:${port}`,
            pid,
            stop: () => { killPid(pid); removeRegistry(port); },
          },
        };
        continue;
      }
      killPid(entry.pid);
      removeRegistry(entry.port);
    }

    if (current !== null) {
      return ok(undefined);
    }

    const ggufPath = join(options.modelsDir, model);
    const result = await spawnServer(ggufPath);
    if (!isOk(result)) {
      current = null;
      return result;
    }

    if (shuttingDown) {
      if (keepAlive()) {
        register(result.value, model);
      } else {
        result.value.stop();
      }
      return err({ code: 'model_load_failed', message: 'local chat is shutting down' });
    }

    const server = result.value;
    current = { model, server, adopted: false };
    register(server, model);
    server.onExit?.(() => {
      if (current?.server === server) {
        current = null;
      }
    });
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

    async prewarm(model) {
      return new Promise((resolve) => {
        mutex = mutex.then(async () => {
          try {
            resolve(await ensure(model));
          } catch (e) {
            current = null;
            resolve(err({ code: 'model_load_failed', message: `prewarm failed: ${(e as Error).message}` }));
          }
        });
      });
    },

    async shutdown() {
      shuttingDown = true;
      if (!keepAlive() && current) {
        current.server.stop();
        releaseRegistration(current.server);
      }
      current = null;
    },

    isReady(model?: string) {
      if (model === undefined) return current !== null;
      return current?.model === model;
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
