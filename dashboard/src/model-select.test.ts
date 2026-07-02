import { describe, it, expect } from 'vitest';
import { MODEL_STORAGE_KEY, resolveInitialModel } from './model-select';
import type { ModelInfo } from './types';

describe('resolveInitialModel', () => {
  const coderModel: ModelInfo = { id: 'coder-1', name: 'DeepSeekCoder', path: '/models/coder.gguf' };
  const genericModel: ModelInfo = { id: 'llama-1', name: 'Llama3', path: '/models/llama.gguf' };
  const anotherModel: ModelInfo = { id: 'qwen-1', name: 'Qwen2', path: '/models/qwen.gguf' };

  it('returns savedId when it is present in the model list', () => {
    const models = [genericModel, coderModel];
    const result = resolveInitialModel(models, 'llama-1');
    expect(result).toBe('llama-1');
  });

  it('falls back to coder model when savedId is not in the list', () => {
    const models = [genericModel, coderModel];
    const result = resolveInitialModel(models, 'nonexistent-id');
    expect(result).toBe('coder-1');
  });

  it('returns first model when no coder model exists', () => {
    const models = [genericModel, anotherModel];
    const result = resolveInitialModel(models, null);
    expect(result).toBe('llama-1');
  });

  it('returns empty string for an empty model list', () => {
    const result = resolveInitialModel([], 'any-id');
    expect(result).toBe('');
  });

  it('returns coder model when savedId is null and coder model exists', () => {
    const models = [genericModel, coderModel, anotherModel];
    const result = resolveInitialModel(models, null);
    expect(result).toBe('coder-1');
  });

  it('exports the storage key constant', () => {
    expect(MODEL_STORAGE_KEY).toBe('pr-map-ai-model');
  });
});
