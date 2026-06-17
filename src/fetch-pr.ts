import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Result, ok, err, isOk } from './result.js';
import type { GhClient, GhError } from './gh-client.js';
import type { NodeStatus, PrMeta } from './types.js';

export interface RawPrFile {
  path: string;
  status: NodeStatus;
  additions: number;
  deletions: number;
  patch?: string;
  previousPath?: string;
  content?: string;
}

export interface RawPr {
  meta: PrMeta;
  files: RawPrFile[];
  diff: string;
}

export interface FetchError {
  message: string;
  cause?: GhError;
}

export function workingDirKey(meta: PrMeta): string {
  return `${meta.owner}-${meta.repo}-${meta.number}`;
}

export async function fetchPr(
  ghClient: GhClient,
  ref: string,
): Promise<Result<RawPr, FetchError>> {
  const metaResult = await ghClient.getPrMetadata(ref);
  if (!isOk(metaResult)) {
    return err(toFetchError('Failed to load PR metadata', metaResult.error));
  }
  const meta = metaResult.value;

  const filesResult = await ghClient.listChangedFiles(meta.number);
  if (!isOk(filesResult)) {
    return err(toFetchError('Failed to list changed files', filesResult.error));
  }

  const diffResult = await ghClient.getDiff(ref);
  if (!isOk(diffResult)) {
    return err(toFetchError('Failed to load PR diff', diffResult.error));
  }

  const files: RawPrFile[] = [];
  for (const file of filesResult.value) {
    const rawFile: RawPrFile = {
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
      previousPath: file.previousPath,
    };
    if (file.status !== 'deleted') {
      const contentResult = await ghClient.getFileContent(file.path, meta.headRef);
      if (isOk(contentResult)) {
        rawFile.content = contentResult.value;
      }
    }
    files.push(rawFile);
  }

  return ok({ meta, files, diff: diffResult.value });
}

export async function writeRaw(
  rawPr: RawPr,
  workingDir: string,
): Promise<Result<string, FetchError>> {
  const directory = join(workingDir, '.pr-map', workingDirKey(rawPr.meta));
  try {
    await mkdir(directory, { recursive: true });
    const filePath = join(directory, 'raw.json');
    await writeFile(filePath, JSON.stringify(rawPr, null, 2), 'utf8');
    return ok(filePath);
  } catch (error) {
    return err({ message: `Failed to write raw.json: ${(error as Error).message}` });
  }
}

function toFetchError(message: string, cause: GhError): FetchError {
  return { message: `${message}: ${cause.message}`, cause };
}
