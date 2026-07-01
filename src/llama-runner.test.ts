import { describe, expect, it } from 'vitest';
import { discoverModels } from './llama-runner.js';

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
});
