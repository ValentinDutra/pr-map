import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export const PID_DIR = join(tmpdir(), 'pr-map-server-pids');

export interface ServerRegistryEntry {
  pid: number;
  port: number;
  model: string;
}

export function writePidFile(pidFilePath: string, pid: number): void {
  try {
    mkdirSync(dirname(pidFilePath), { recursive: true });
    writeFileSync(pidFilePath, String(pid));
  } catch {
  }
}

export function removePidFile(pidFilePath: string, expectedPid?: number): void {
  try {
    if (expectedPid !== undefined) {
      const content = readFileSync(pidFilePath, 'utf8').trim();
      if (content !== String(expectedPid)) {
        return;
      }
    }
    rmSync(pidFilePath, { force: true });
  } catch {
  }
}

export function writeServerRegistry(registryFilePath: string, entry: ServerRegistryEntry): void {
  try {
    mkdirSync(dirname(registryFilePath), { recursive: true });
    writeFileSync(registryFilePath, JSON.stringify(entry));
  } catch {
  }
}

export function readServerRegistry(registryFilePath: string): ServerRegistryEntry | null {
  try {
    const parsed = JSON.parse(readFileSync(registryFilePath, 'utf8')) as ServerRegistryEntry;
    if (
      typeof parsed?.pid === 'number' &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed?.port === 'number' &&
      typeof parsed?.model === 'string'
    ) {
      return { pid: parsed.pid, port: parsed.port, model: parsed.model };
    }
    return null;
  } catch {
    return null;
  }
}

export function listServerRegistry(dir: string): ServerRegistryEntry[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('-llama.json'))
      .map((name) => readServerRegistry(join(dir, name)))
      .filter((entry): entry is ServerRegistryEntry => entry !== null);
  } catch {
    return [];
  }
}

export function removeServerRegistry(registryFilePath: string): void {
  try {
    rmSync(registryFilePath, { force: true });
  } catch {
  }
}
