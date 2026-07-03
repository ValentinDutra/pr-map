import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunningServer } from './llama-runner.js';
import { createLlamaSpawner, createLocalChat, discoverModels } from './llama-runner.js';
import type { LlmError, LlmProvider } from './llm-provider.js';
import { type Result, err, isOk, ok } from './result.js';

describe('discoverModels', () => {
  it('filters mmproj and non-gguf files, returning only real chat models', () => {
    const modelsDir = '/home/user/models';
    const ggufPaths = [
      `${modelsDir}/qwen3-4b/Qwen3-4B-Q4_K_M.gguf`,
      `${modelsDir}/gemma-3-4b/gemma-3-4b-it-Q4_K_M.gguf`,
      `${modelsDir}/gemma-3-4b/mmproj-model-f16.gguf`,
      `${modelsDir}/notes.txt`,
    ];

    const models = discoverModels(ggufPaths, modelsDir);

    expect(models).toHaveLength(2);
    expect(models).toContainEqual({
      id: 'qwen3-4b/Qwen3-4B-Q4_K_M.gguf',
      name: 'qwen3-4b',
      path: `${modelsDir}/qwen3-4b/Qwen3-4B-Q4_K_M.gguf`,
    });
    expect(models).toContainEqual({
      id: 'gemma-3-4b/gemma-3-4b-it-Q4_K_M.gguf',
      name: 'gemma-3-4b',
      path: `${modelsDir}/gemma-3-4b/gemma-3-4b-it-Q4_K_M.gguf`,
    });
  });

  it('uses filename without extension as name when file is at modelsDir root', () => {
    const modelsDir = '/models';
    const ggufPaths = [`${modelsDir}/my-model-q4.gguf`];

    const models = discoverModels(ggufPaths, modelsDir);

    expect(models).toEqual([
      {
        id: 'my-model-q4.gguf',
        name: 'my-model-q4',
        path: `${modelsDir}/my-model-q4.gguf`,
      },
    ]);
  });

  it('filters mmproj files case-insensitively', () => {
    const modelsDir = '/models';
    const ggufPaths = [
      `${modelsDir}/vision/MMPROJ-Model.GGUF`,
      `${modelsDir}/vision/real-model.gguf`,
    ];

    const models = discoverModels(ggufPaths, modelsDir);

    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('vision');
  });

  it('strips uppercase extension from root-level filename', () => {
    const modelsDir = '/models';
    const ggufPaths = [`${modelsDir}/Model-Q4.GGUF`];

    const models = discoverModels(ggufPaths, modelsDir);

    expect(models).toEqual([
      {
        id: 'Model-Q4.GGUF',
        name: 'Model-Q4',
        path: `${modelsDir}/Model-Q4.GGUF`,
      },
    ]);
  });
});

describe('listModels', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llama-runner-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('discovers gguf files recursively and filters out mmproj', async () => {
    await mkdir(join(tempDir, 'm1'), { recursive: true });
    await mkdir(join(tempDir, 'empty-sub'), { recursive: true });
    await writeFile(join(tempDir, 'm1', 'model-a-q4.gguf'), '');
    await writeFile(join(tempDir, 'm1', 'mmproj-model-f16.gguf'), '');

    const localChat = createLocalChat({ modelsDir: tempDir });
    const result = await localChat.listModels();

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toEqual({
      id: 'm1/model-a-q4.gguf',
      name: 'm1',
      path: join(tempDir, 'm1', 'model-a-q4.gguf'),
    });
  });

  it('returns ok([]) for a non-existent directory', async () => {
    const localChat = createLocalChat({ modelsDir: join(tempDir, 'does-not-exist') });
    const result = await localChat.listModels();

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toEqual([]);
  });
});

describe('createLlamaSpawner', () => {
  function createFakeChild() {
    const emitter = new EventEmitter() as EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn> };
    emitter.pid = 12345;
    emitter.kill = vi.fn();
    return emitter;
  }

  it('resolves err with code llama_not_found when child emits ENOENT error', async () => {
    const fakeChild = createFakeChild();
    const spawn = vi.fn(() => {
      setImmediate(() => fakeChild.emit('error', { code: 'ENOENT' }));
      return fakeChild;
    });

    const spawnServer = createLlamaSpawner({
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetchFn: vi.fn(),
      pickPort: async () => 9999,
      readyTimeoutMs: 100,
      pollIntervalMs: 10,
      writePid: () => {},
      removePid: () => {},
    });

    const result = await spawnServer('/path/to/model.gguf');

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('llama_not_found');
    }
  });

  it('resolves ok with baseUrl and stop when health returns ok', async () => {
    const fakeChild = createFakeChild();
    const spawn = vi.fn(() => fakeChild);
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok' }),
    })) as unknown as typeof fetch;

    const spawnServer = createLlamaSpawner({
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetchFn,
      pickPort: async () => 8888,
      readyTimeoutMs: 1000,
      pollIntervalMs: 10,
      writePid: () => {},
      removePid: () => {},
    });

    const result = await spawnServer('/path/to/model.gguf');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.baseUrl).toBe('http://127.0.0.1:8888');
      result.value.stop();
      expect(fakeChild.kill).toHaveBeenCalled();
    }
  });

  it('writes pid file immediately after spawn with path ending in port-llama.pid', async () => {
    const fakeChild = createFakeChild();
    const spawn = vi.fn(() => fakeChild);
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok' }),
    })) as unknown as typeof fetch;
    const writePidCalls: Array<{ path: string; pid: number }> = [];

    const spawnServer = createLlamaSpawner({
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetchFn,
      pickPort: async () => 5555,
      readyTimeoutMs: 1000,
      pollIntervalMs: 10,
      writePid: (path, pid) => writePidCalls.push({ path, pid }),
      removePid: () => {},
    });

    await spawnServer('/path/to/model.gguf');

    expect(writePidCalls).toHaveLength(1);
    expect(writePidCalls[0].path).toMatch(/5555-llama\.pid$/);
    expect(writePidCalls[0].pid).toBe(12345);
  });

  it('calls removePid when stop is invoked', async () => {
    const fakeChild = createFakeChild();
    const spawn = vi.fn(() => fakeChild);
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok' }),
    })) as unknown as typeof fetch;
    const removePidCalls: string[] = [];
    let writtenPath = '';

    const spawnServer = createLlamaSpawner({
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetchFn,
      pickPort: async () => 4444,
      readyTimeoutMs: 1000,
      pollIntervalMs: 10,
      writePid: (path) => { writtenPath = path; },
      removePid: (path) => removePidCalls.push(path),
    });

    const result = await spawnServer('/path/to/model.gguf');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      result.value.stop();
      expect(removePidCalls).toHaveLength(1);
      expect(removePidCalls[0]).toBe(writtenPath);
    }
  });

  it('calls removePid when child emits exit event', async () => {
    const fakeChild = createFakeChild();
    const spawn = vi.fn(() => fakeChild);
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok' }),
    })) as unknown as typeof fetch;
    const removePidCalls: string[] = [];
    let writtenPath = '';

    const spawnServer = createLlamaSpawner({
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetchFn,
      pickPort: async () => 3333,
      readyTimeoutMs: 1000,
      pollIntervalMs: 10,
      writePid: (path) => { writtenPath = path; },
      removePid: (path) => removePidCalls.push(path),
    });

    const result = await spawnServer('/path/to/model.gguf');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      fakeChild.emit('exit', 0, null);
      expect(removePidCalls).toHaveLength(1);
      expect(removePidCalls[0]).toBe(writtenPath);
    }
  });

  it('resolves err with code model_load_failed and kills child when health never returns ok', async () => {
    const fakeChild = createFakeChild();
    const spawn = vi.fn(() => fakeChild);
    const fetchFn = vi.fn(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const writePidCalls: Array<{ path: string; pid: number }> = [];

    const spawnServer = createLlamaSpawner({
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetchFn,
      pickPort: async () => 7777,
      readyTimeoutMs: 50,
      pollIntervalMs: 10,
      writePid: (path, pid) => writePidCalls.push({ path, pid }),
      removePid: () => {},
    });

    const result = await spawnServer('/path/to/model.gguf');

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('model_load_failed');
    }
    expect(fakeChild.kill).toHaveBeenCalled();

    // Prove pid file was written during cold-start (before health-ok)
    expect(writePidCalls).toHaveLength(1);
    expect(writePidCalls[0].path).toMatch(/7777-llama\.pid$/);
    expect(writePidCalls[0].pid).toBe(12345);
  });

  it('resolves err with code model_load_failed immediately when child exits early', async () => {
    const fakeChild = createFakeChild();
    const spawn = vi.fn(() => {
      // Simulate child exiting early (e.g., bad GGUF path)
      setImmediate(() => fakeChild.emit('exit', 1, null));
      return fakeChild;
    });
    const fetchFn = vi.fn(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;

    const spawnServer = createLlamaSpawner({
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetchFn,
      pickPort: async () => 6666,
      readyTimeoutMs: 5000, // Long timeout - should NOT wait this long
      pollIntervalMs: 10,
      writePid: () => {},
      removePid: () => {},
    });

    const startTime = Date.now();
    const result = await spawnServer('/path/to/bad-model.gguf');
    const elapsed = Date.now() - startTime;

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('model_load_failed');
    }
    // Should resolve quickly, not wait for readyTimeoutMs
    expect(elapsed).toBeLessThan(500);
  });

  it('resolves err when pickPort rejects instead of throwing', async () => {
    const spawnServer = createLlamaSpawner({
      spawn: vi.fn() as unknown as typeof import('node:child_process').spawn,
      fetchFn: vi.fn() as unknown as typeof fetch,
      pickPort: async () => {
        throw new Error('network error');
      },
      readyTimeoutMs: 100,
      pollIntervalMs: 10,
      writePid: () => {},
      removePid: () => {},
    });

    const result = await spawnServer('/path/to/model.gguf');

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('model_load_failed');
      expect(result.error.message).toContain('network error');
    }
  });
});

describe('ask/shutdown', () => {
  function createFakeSpawnServer() {
    const stopSpy = vi.fn();
    const spawnServer = vi.fn(
      async (_ggufPath: string): Promise<Result<RunningServer, LlmError>> => {
        return ok({ baseUrl: 'http://127.0.0.1:9999', stop: stopSpy });
      },
    );
    return { spawnServer, stopSpy };
  }

  function createFakeProvider(): LlmProvider {
    return {
      chat: async (messages) => ok(`reply:${messages.length}`),
      complete: async () => ok(''),
    };
  }

  function createCrashableSpawnServer() {
    const servers: Array<{ triggerExit: () => void; stop: ReturnType<typeof vi.fn> }> = [];
    let callCount = 0;
    const spawnServer = vi.fn(async (): Promise<Result<RunningServer, LlmError>> => {
      callCount++;
      const listeners: Array<() => void> = [];
      const stop = vi.fn();
      const server: RunningServer = {
        baseUrl: `http://127.0.0.1:${9000 + callCount}`,
        stop,
        onExit: (cb) => { listeners.push(cb); },
      };
      servers.push({ triggerExit: () => { for (const l of listeners) l(); }, stop });
      return ok(server);
    });
    return { spawnServer, servers };
  }

  it('concurrent asks for same model spawn server exactly once', async () => {
    const { spawnServer, stopSpy } = createFakeSpawnServer();
    const providerFor = vi.fn(() => createFakeProvider());

    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor,
    });

    const [r1, r2] = await Promise.all([
      localChat.ask({ model: 'm1.gguf', messages: [{ role: 'user', content: 'hi' }] }),
      localChat.ask({ model: 'm1.gguf', messages: [{ role: 'user', content: 'hello' }] }),
    ]);

    expect(isOk(r1)).toBe(true);
    expect(isOk(r2)).toBe(true);
    expect(spawnServer).toHaveBeenCalledTimes(1);
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it('swapping models stops the previous server before spawning the next', async () => {
    const stop1 = vi.fn();
    const stop2 = vi.fn();
    let callCount = 0;
    const spawnServer = vi.fn(async (): Promise<Result<RunningServer, LlmError>> => {
      callCount++;
      return ok({
        baseUrl: `http://127.0.0.1:${9000 + callCount}`,
        stop: callCount === 1 ? stop1 : stop2,
      });
    });

    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    await localChat.ask({ model: 'm1.gguf', messages: [{ role: 'user', content: 'a' }] });
    expect(spawnServer).toHaveBeenCalledTimes(1);
    expect(stop1).not.toHaveBeenCalled();

    await localChat.ask({ model: 'm2.gguf', messages: [{ role: 'user', content: 'b' }] });
    expect(spawnServer).toHaveBeenCalledTimes(2);
    expect(stop1).toHaveBeenCalledTimes(1);
    expect(stop2).not.toHaveBeenCalled();
  });

  it('returns the spawn error when spawnServer fails', async () => {
    const spawnServer = vi.fn(
      async (): Promise<Result<RunningServer, LlmError>> =>
        err({ code: 'llama_not_found', message: 'not installed' }),
    );

    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    const result = await localChat.ask({
      model: 'm1.gguf',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('llama_not_found');
    }
  });

  it('returns provider reply on success', async () => {
    const { spawnServer } = createFakeSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    const result = await localChat.ask({
      model: 'm1.gguf',
      messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe('reply:2');
    }
  });

  it('shutdown stops the running server and is idempotent', async () => {
    const { spawnServer, stopSpy } = createFakeSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    await localChat.ask({ model: 'm1.gguf', messages: [{ role: 'user', content: 'hi' }] });
    expect(stopSpy).not.toHaveBeenCalled();

    await localChat.shutdown();
    expect(stopSpy).toHaveBeenCalledTimes(1);

    await localChat.shutdown();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('does not poison the mutex when spawnServer throws (subsequent asks succeed)', async () => {
    let callCount = 0;
    const spawnServer = vi.fn(async (): Promise<Result<RunningServer, LlmError>> => {
      callCount++;
      if (callCount === 1) {
        throw new Error('transient failure');
      }
      return ok({ baseUrl: 'http://127.0.0.1:9999', stop: vi.fn() });
    });

    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    const r1 = await localChat.ask({ model: 'm1.gguf', messages: [{ role: 'user', content: 'a' }] });
    expect(isOk(r1)).toBe(false);

    const r2 = await localChat.ask({ model: 'm2.gguf', messages: [{ role: 'user', content: 'b' }] });
    expect(isOk(r2)).toBe(true);
    expect(spawnServer).toHaveBeenCalledTimes(2);
  });

  it('does not poison the mutex when provider.chat throws (subsequent asks succeed)', async () => {
    const { spawnServer } = createFakeSpawnServer();
    let chatCallCount = 0;
    const providerFor = () => ({
      chat: async () => {
        chatCallCount++;
        if (chatCallCount === 1) {
          throw new Error('provider threw');
        }
        return ok('reply');
      },
      complete: async () => ok(''),
    });

    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor,
    });

    const r1 = await localChat.ask({ model: 'm1.gguf', messages: [{ role: 'user', content: 'a' }] });
    expect(isOk(r1)).toBe(false);

    const r2 = await localChat.ask({ model: 'm1.gguf', messages: [{ role: 'user', content: 'b' }] });
    expect(isOk(r2)).toBe(true);
    if (isOk(r2)) {
      expect(r2.value).toBe('reply');
    }
  });

  it('shutdown does not block behind an in-flight chat', async () => {
    const stopSpy = vi.fn();
    const spawnServer = vi.fn(
      async (): Promise<Result<RunningServer, LlmError>> =>
        ok({ baseUrl: 'http://127.0.0.1:9999', stop: stopSpy }),
    );
    const providerFor = () => ({
      chat: async () => new Promise<never>(() => {}), // Never resolves
      complete: async () => ok(''),
    });

    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor,
    });

    // Start an ask but don't await it - it will hang on chat()
    const askPromise = localChat.ask({
      model: 'm1.gguf',
      messages: [{ role: 'user', content: 'hi' }],
    });

    // Let ensure/spawn settle
    await new Promise((r) => setImmediate(r));
    expect(spawnServer).toHaveBeenCalledTimes(1);

    // shutdown() should resolve promptly, not wait behind the hung chat
    const startTime = Date.now();
    await localChat.shutdown();
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeLessThan(100);
    expect(stopSpy).toHaveBeenCalledTimes(1);

    // Clean up - the askPromise will never resolve, but that's fine for the test
    void askPromise;
  });

  it('isReady returns false before any ask, true after successful ask, false after shutdown', async () => {
    const spawnServer = vi.fn(
      async (): Promise<Result<RunningServer, LlmError>> =>
        ok({ baseUrl: 'http://127.0.0.1:1', stop: () => {} }),
    );
    const providerFor = () => ({
      chat: async () => ok('hi'),
      complete: async () => ok('hi'),
    });

    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor,
    });

    expect(localChat.isReady()).toBe(false);

    await localChat.ask({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect(localChat.isReady()).toBe(true);

    await localChat.shutdown();
    expect(localChat.isReady()).toBe(false);
  });

  it('isReady is model-scoped: true for the warm model, false for another', async () => {
    const { spawnServer } = createFakeSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    await localChat.prewarm('A');

    expect(localChat.isReady('A')).toBe(true);
    expect(localChat.isReady('B')).toBe(false);
    expect(localChat.isReady()).toBe(true);
  });

  it('resets current when spawnServer throws during swap so same-model ask respawns', async () => {
    const stop1 = vi.fn();
    let callCount = 0;
    const spawnServer = vi.fn(async (): Promise<Result<RunningServer, LlmError>> => {
      callCount++;
      if (callCount === 1) {
        return ok({ baseUrl: 'http://127.0.0.1:9999', stop: stop1 });
      }
      if (callCount === 2) {
        // Second call (swap to m2) throws
        throw new Error('spawn failed during swap');
      }
      // Third call succeeds
      return ok({ baseUrl: 'http://127.0.0.1:8888', stop: vi.fn() });
    });

    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    // First ask for m1 succeeds
    const r1 = await localChat.ask({ model: 'm1.gguf', messages: [{ role: 'user', content: 'a' }] });
    expect(isOk(r1)).toBe(true);

    // Second ask for m2 (swap) fails - spawnServer throws after stop1 was called
    const r2 = await localChat.ask({ model: 'm2.gguf', messages: [{ role: 'user', content: 'b' }] });
    expect(isOk(r2)).toBe(false);
    expect(stop1).toHaveBeenCalledTimes(1);

    // Third ask for m1 again - if current wasn't reset, this would reuse the dead m1 server
    // Instead it should spawn a new server (callCount 3)
    const r3 = await localChat.ask({ model: 'm1.gguf', messages: [{ role: 'user', content: 'c' }] });
    expect(spawnServer).toHaveBeenCalledTimes(3);
    expect(isOk(r3)).toBe(true);
  });

  it('detects an unexpected child exit and respawns on the next ask', async () => {
    const { spawnServer, servers } = createCrashableSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    const r1 = await localChat.ask({ model: 'm', messages: [{ role: 'user', content: 'a' }] });
    expect(isOk(r1)).toBe(true);
    expect(localChat.isReady()).toBe(true);

    servers[0].triggerExit();
    expect(localChat.isReady()).toBe(false);

    const r2 = await localChat.ask({ model: 'm', messages: [{ role: 'user', content: 'b' }] });
    expect(isOk(r2)).toBe(true);
    expect(spawnServer).toHaveBeenCalledTimes(2);
    expect(localChat.isReady()).toBe(true);
  });

  it('a late exit from a swapped-out server does not clear the newer current', async () => {
    const { spawnServer, servers } = createCrashableSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    await localChat.ask({ model: 'A', messages: [{ role: 'user', content: 'a' }] });
    await localChat.ask({ model: 'B', messages: [{ role: 'user', content: 'b' }] });
    expect(spawnServer).toHaveBeenCalledTimes(2);
    expect(localChat.isReady()).toBe(true);

    servers[0].triggerExit();

    expect(localChat.isReady()).toBe(true);
    const r = await localChat.ask({ model: 'B', messages: [{ role: 'user', content: 'c' }] });
    expect(isOk(r)).toBe(true);
    expect(spawnServer).toHaveBeenCalledTimes(2);
  });

  it('prewarm spawns the server once and leaves isReady true', async () => {
    const { spawnServer } = createFakeSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    expect(localChat.isReady()).toBe(false);

    const result = await localChat.prewarm('m');

    expect(isOk(result)).toBe(true);
    expect(localChat.isReady()).toBe(true);
    expect(spawnServer).toHaveBeenCalledTimes(1);
  });

  it('prewarm twice for the same model spawns exactly once', async () => {
    const { spawnServer } = createFakeSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    await localChat.prewarm('m');
    await localChat.prewarm('m');

    expect(spawnServer).toHaveBeenCalledTimes(1);
  });

  it('prewarm then ask for the same model spawns exactly once', async () => {
    const { spawnServer } = createFakeSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    await localChat.prewarm('m');
    const result = await localChat.ask({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });

    expect(isOk(result)).toBe(true);
    expect(spawnServer).toHaveBeenCalledTimes(1);
  });

  it('prewarm returns the spawn err and leaves isReady false when spawnServer returns err', async () => {
    const spawnServer = vi.fn(
      async (): Promise<Result<RunningServer, LlmError>> =>
        err({ code: 'llama_not_found', message: 'not installed' }),
    );
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    const result = await localChat.prewarm('m');

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('llama_not_found');
    }
    expect(localChat.isReady()).toBe(false);
  });

  it('prewarm returns model_load_failed and leaves isReady false when spawnServer throws', async () => {
    const spawnServer = vi.fn(async (): Promise<Result<RunningServer, LlmError>> => {
      throw new Error('spawn exploded');
    });
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    const result = await localChat.prewarm('m');

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('model_load_failed');
    }
    expect(localChat.isReady()).toBe(false);
  });

  it('ask after a failed prewarm respawns and succeeds (mutex not poisoned)', async () => {
    let callCount = 0;
    const spawnServer = vi.fn(async (): Promise<Result<RunningServer, LlmError>> => {
      callCount++;
      if (callCount === 1) {
        throw new Error('transient failure');
      }
      return ok({ baseUrl: 'http://127.0.0.1:9999', stop: vi.fn() });
    });
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    const prewarmResult = await localChat.prewarm('m');
    expect(isOk(prewarmResult)).toBe(false);

    const askResult = await localChat.ask({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(isOk(askResult)).toBe(true);
    expect(spawnServer).toHaveBeenCalledTimes(2);
  });

  it('rejects a traversal model id for ask without spawning', async () => {
    const { spawnServer } = createFakeSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    const result = await localChat.ask({
      model: '../outside.gguf',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('model_load_failed');
    }
    expect(spawnServer).not.toHaveBeenCalled();
  });

  it('rejects a traversal model id for prewarm without spawning', async () => {
    const { spawnServer } = createFakeSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    const result = await localChat.prewarm('../outside.gguf');

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('model_load_failed');
    }
    expect(spawnServer).not.toHaveBeenCalled();
    expect(localChat.isReady()).toBe(false);
  });

  it('rejects an absolute model path without spawning', async () => {
    const { spawnServer } = createFakeSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    const result = await localChat.ask({
      model: '/etc/passwd',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('model_load_failed');
    }
    expect(spawnServer).not.toHaveBeenCalled();
  });

  it('spawns for a legitimate nested model id under the models directory', async () => {
    const { spawnServer } = createFakeSpawnServer();
    const localChat = createLocalChat({
      modelsDir: '/models',
      spawnServer,
      providerFor: () => createFakeProvider(),
    });

    const result = await localChat.ask({
      model: 'subdir/model.gguf',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(isOk(result)).toBe(true);
    expect(spawnServer).toHaveBeenCalledTimes(1);
    expect(spawnServer).toHaveBeenCalledWith(join('/models', 'subdir/model.gguf'));
  });
});
