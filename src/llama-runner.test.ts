import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLlamaSpawner, createLocalChat, discoverModels } from './llama-runner.js';
import { isOk } from './result.js';

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
    });

    const result = await spawnServer('/path/to/model.gguf');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.baseUrl).toBe('http://127.0.0.1:8888');
      result.value.stop();
      expect(fakeChild.kill).toHaveBeenCalled();
    }
  });

  it('resolves err with code model_load_failed and kills child when health never returns ok', async () => {
    const fakeChild = createFakeChild();
    const spawn = vi.fn(() => fakeChild);
    const fetchFn = vi.fn(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;

    const spawnServer = createLlamaSpawner({
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetchFn,
      pickPort: async () => 7777,
      readyTimeoutMs: 50,
      pollIntervalMs: 10,
    });

    const result = await spawnServer('/path/to/model.gguf');

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error.code).toBe('model_load_failed');
    }
    expect(fakeChild.kill).toHaveBeenCalled();
  });
});
