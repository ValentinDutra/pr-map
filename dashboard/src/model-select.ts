import type { ModelInfo } from './types';

export const MODEL_STORAGE_KEY = 'pr-map-ai-model';

export function resolveInitialModel(
  models: ModelInfo[],
  savedId: string | null
): string {
  if (savedId && models.some((m) => m.id === savedId)) {
    return savedId;
  }
  const coder = models.find((m) => m.name.toLowerCase().includes('coder'));
  if (coder) {
    return coder.id;
  }
  return models[0]?.id ?? '';
}
