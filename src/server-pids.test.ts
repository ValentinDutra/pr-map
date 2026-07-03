import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listServerRegistry,
  readServerRegistry,
  removePidFile,
  removeServerRegistry,
  writePidFile,
  writeServerRegistry,
} from './server-pids.js';

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

  describe('server registry', () => {
    it('writes an entry that reads back as the same record', () => {
      const registryFile = join(tempDir, 'sub', '8080-llama.json');

      writeServerRegistry(registryFile, { pid: 42, port: 8080, model: 'm1/model.gguf' });

      expect(readServerRegistry(registryFile)).toEqual({ pid: 42, port: 8080, model: 'm1/model.gguf' });
    });

    it('does not throw when writing to an un-writable path', () => {
      const blocker = join(tempDir, 'blocker');
      writeFileSync(blocker, 'I am a file');
      const registryFile = join(blocker, 'subdir', '1-llama.json');

      expect(() => writeServerRegistry(registryFile, { pid: 1, port: 1, model: 'm' })).not.toThrow();
    });

    it('returns null when the file is missing or malformed', () => {
      expect(readServerRegistry(join(tempDir, 'missing.json'))).toBeNull();

      const bad = join(tempDir, 'bad-llama.json');
      writeFileSync(bad, 'not json');
      expect(readServerRegistry(bad)).toBeNull();

      const wrongShape = join(tempDir, 'wrong-llama.json');
      writeFileSync(wrongShape, JSON.stringify({ pid: 'x', port: 1, model: 'm' }));
      expect(readServerRegistry(wrongShape)).toBeNull();
    });

    it('lists only well-formed *-llama.json entries in a directory', () => {
      writeServerRegistry(join(tempDir, '1-llama.json'), { pid: 1, port: 1, model: 'a' });
      writeServerRegistry(join(tempDir, '2-llama.json'), { pid: 2, port: 2, model: 'b' });
      writeFileSync(join(tempDir, '3-llama.json'), 'garbage');
      writeFileSync(join(tempDir, '99.pid'), '99');

      const entries = listServerRegistry(tempDir);

      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual({ pid: 1, port: 1, model: 'a' });
      expect(entries).toContainEqual({ pid: 2, port: 2, model: 'b' });
    });

    it('returns an empty list for a non-existent directory', () => {
      expect(listServerRegistry(join(tempDir, 'nope'))).toEqual([]);
    });

    it('removes an existing entry and is silent when it is already gone', () => {
      const registryFile = join(tempDir, '7-llama.json');
      writeServerRegistry(registryFile, { pid: 7, port: 7, model: 'm' });
      expect(existsSync(registryFile)).toBe(true);

      removeServerRegistry(registryFile);
      expect(existsSync(registryFile)).toBe(false);

      expect(() => removeServerRegistry(registryFile)).not.toThrow();
    });
  });
});
