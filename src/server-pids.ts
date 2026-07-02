import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export const PID_DIR = join(tmpdir(), 'pr-map-server-pids');

export function writePidFile(pidFilePath: string, pid: number): void {
  try {
    mkdirSync(dirname(pidFilePath), { recursive: true });
    writeFileSync(pidFilePath, String(pid));
  } catch {
    // Best effort: a filesystem failure must never throw into ask/spawn.
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
    // Best effort: cleanup hook handles stale files.
  }
}
