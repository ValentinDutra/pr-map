import { basename, dirname, relative } from 'node:path';
import type { ModelInfo } from './types.js';

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
      const name = isNested ? basename(parentDir) : basename(p, '.gguf');
      return { id, name, path: p };
    });
}
