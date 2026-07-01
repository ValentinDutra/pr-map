import { readdir } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import type { LlmError } from './llm-provider.js';
import { type Result, ok } from './result.js';
import type { ModelInfo } from './types.js';

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
      const name = isNested ? basename(parentDir) : basename(p, '.gguf');
      return { id, name, path: p };
    });
}
