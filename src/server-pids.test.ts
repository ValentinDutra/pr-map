import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removePidFile, writePidFile } from './server-pids.js';

describe('server-pids', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pr-map-pids-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('writePidFile', () => {
    it('creates the missing parent dir and writes the pid', () => {
      const pidFile = join(tempDir, 'sub', '123.pid');

      writePidFile(pidFile, 123);

      expect(existsSync(pidFile)).toBe(true);
      expect(readFileSync(pidFile, 'utf8')).toBe('123');
    });

    it('does not throw when writing to an un-writable path', () => {
      // Create a regular file where a directory would need to be
      const blocker = join(tempDir, 'blocker');
      writeFileSync(blocker, 'I am a file');
      const pidFile = join(blocker, 'subdir', '123.pid');

      expect(() => writePidFile(pidFile, 123)).not.toThrow();
    });
  });

  describe('removePidFile', () => {
    it('deletes an existing file', () => {
      const pidFile = join(tempDir, '456.pid');
      writeFileSync(pidFile, '456');
      expect(existsSync(pidFile)).toBe(true);

      removePidFile(pidFile);

      expect(existsSync(pidFile)).toBe(false);
    });

    it('does not throw when file does not exist', () => {
      const pidFile = join(tempDir, 'nonexistent.pid');

      expect(() => removePidFile(pidFile)).not.toThrow();
    });

    it('deletes the file when expectedPid matches file content', () => {
      const pidFile = join(tempDir, '789.pid');
      writeFileSync(pidFile, '789');
      expect(existsSync(pidFile)).toBe(true);

      removePidFile(pidFile, 789);

      expect(existsSync(pidFile)).toBe(false);
    });

    it('leaves the file in place when expectedPid differs from file content', () => {
      const pidFile = join(tempDir, '111.pid');
      writeFileSync(pidFile, '222');
      expect(existsSync(pidFile)).toBe(true);

      removePidFile(pidFile, 111);

      expect(existsSync(pidFile)).toBe(true);
      expect(readFileSync(pidFile, 'utf8')).toBe('222');
    });
  });
});
