# #58 — Orphan-safety: no stray llama-server after a hard kill

## Goal
When `ask` spawns a `llama-server` child, record its PID in the same `pr-map-server-pids`
directory the SessionEnd cleanup hook already sweeps, so that even a `kill -9` of the node
dashboard process (bypassing graceful shutdown) leaves no orphaned `llama-server` consuming
RAM/GPU. The PID file is removed on graceful `shutdown()` and when the child exits.

## Approach
Extract the PID-file location and its write/remove into a small shared module
`src/server-pids.ts` — the single source for `PID_DIR`, used by BOTH `server.ts` (the node
process PID, one file per port) and the new llama-child PID file. The dir constant cannot live
in `server.ts` because `server.ts` imports `./llama-runner.js` (line 11), so llama-runner
importing from server.ts would be a cycle — the shared module is required, not merely tidy.
Write the llama child PID **right after `spawn` returns** (not at health-ok) so a hard kill
during the cold-start window is still cleaned up; remove it in both `RunningServer.stop()` and
the child `exit` handler. All pid-file writes/removes are best-effort (swallow errors) so a
filesystem failure can never throw into `ask`/spawn or wedge the ask-serialization mutex. The
existing `pr-map-plugin/hooks/cleanup-server.sh` already globs `*.pid` and guards stale PIDs
with `kill -0`, so it needs no change.

## Constraints
- Do NOT modify `pr-map-plugin/hooks/cleanup-server.sh` — it already sweeps `$PID_DIR/*.pid` and
  guards stale PIDs with `kill -0`, so `<port>-llama.pid` is handled for free.
- Do NOT change the `/api/ai/*` contract, the `ask`/`shutdown` semantics, the spawn command, or
  its flags (`llama-server -m <gguf> --port <port> --host 127.0.0.1 --no-webui`).
- `server.ts` changes are LIMITED to sourcing `PID_DIR` and the two helpers from
  `server-pids.ts` in place of its inline `mkdirSync`/`writeFileSync`/`rmSync`; behavior must be
  byte-for-byte identical. Do NOT restructure `registerGracefulShutdown` or the startup flow.
- pid-file writes and removes MUST be best-effort (wrapped in try/catch, errors swallowed) —
  they must never throw into `ask`/spawn nor reject/hang the spawn Promise.
- Write the llama pid file RIGHT AFTER `spawn` (covering cold start); do NOT defer it to the
  health-ok branch.
- Frontend is untouched (`dashboard/**`). No changes outside `src/server-pids.ts`,
  `src/server.ts`, `src/llama-runner.ts`, and their test files.

## Patterns to follow
- PID-file convention (dir, one file per port, mkdir-recursive + writeFileSync, rmSync force):
  `src/server.ts` (`PID_DIR` at line 27; write at ~156-161; `rmSync` in `registerGracefulShutdown`
  at ~120).
- Dependency-injection seams with real defaults + fakes in tests: `src/llama-runner.ts`
  (`LlamaSpawnerDeps` with injected `spawn`/`fetchFn`/`pickPort`) and its tests
  `src/llama-runner.test.ts`.
- Cleanup hook (read-only reference, do not edit): `pr-map-plugin/hooks/cleanup-server.sh`.
- Result/error conventions: `src/result.ts`, `src/llm-provider.ts` (`LlmError` codes).

## Verification commands
- Tests: `npm test`
- Lint: `npm run lint`
- Type check / build: `npm --prefix dashboard run build`

## Current state
- `src/llama-runner.ts`: `createLlamaSpawner(deps)` picks a free port, spawns
  `llama-server ... --port <port> ...` (line 61 — `child.pid` is available immediately after),
  polls `/health`, and on ready resolves `ok({ baseUrl, stop: () => child.kill() })`. A
  `child.on('exit')` handler exists only for the early-exit-before-ready error case. `LocalChat`
  swaps models via `current?.server.stop()` in `ensure()` and tears down via `shutdown()`
  (`current?.server.stop(); current = null`). No PID file is written today. `ask` serializes
  through a promise-chain mutex; a throw inside the spawn Promise executor rejects (caught by
  `ask`'s try/catch), but a throw inside `pollHealth` would never resolve → mutex wedge.
- `src/server.ts`: `const PID_DIR = join(tmpdir(), 'pr-map-server-pids')` (line 27); on startup
  writes `join(PID_DIR, `${port}.pid`)` = `String(process.pid)` via `mkdirSync(PID_DIR, {
  recursive: true })` + `writeFileSync(...)` in a non-fatal try/catch (~156-163);
  `registerGracefulShutdown` removes it with `rmSync(pidFile, { force: true })` (~120). Imports
  `existsSync, mkdirSync, rmSync, writeFileSync` from `node:fs` (line 4; `existsSync` is also
  used at line 34), and `createLocalChat` from `./llama-runner.js` (line 11).
- `pr-map-plugin/hooks/cleanup-server.sh`: SessionEnd hook; for each `$PID_DIR/*.pid` reads the
  PID, `kill -0` guards it, `kill`s it, and `rm`s the file.
- `src/llama-runner.test.ts`: spawner tests inject a fake `spawn` returning a child stub
  (EventEmitter-like with `pid`, `kill`, `on`), plus fake `fetchFn`/`pickPort`, to drive the
  ready/early-exit/timeout paths without a real binary.

## Desired end state
- On a successful spawn, `<PID_DIR>/<port>-llama.pid` contains the llama-server child PID,
  written immediately after `spawn` (before health polling completes).
- That file is removed when the server is stopped (`RunningServer.stop()`, hence on model swap
  and on `shutdown()`) AND when the child process emits `exit`.
- After `kill -9` of the node process, the file remains; running `cleanup-server.sh` kills the
  recorded llama PID (`kill -0`-guarded) and removes the file, so `pgrep llama-server` returns
  nothing.
- All pid-file write/remove failures are swallowed; `ask`/`shutdown`/spawn behavior and the
  `/api/ai/*` contract are unchanged.
- `PID_DIR` and the write/remove helpers have a single home in `src/server-pids.ts`, imported by
  both `server.ts` and `llama-runner.ts`.

## Edge cases and risks
- A throw inside the spawn Promise executor rejects the promise (caught by `ask`); a throw
  inside `pollHealth` never resolves and wedges the mutex — so the pid write must be guarded and
  sit right after `spawn`, outside any path that could leave the promise unresolved.
- Writing only at health-ok would leave the cold-start seconds untracked — write right after
  `spawn`.
- `removePidFile` must be idempotent (`rmSync` with `force: true`), since it is called from both
  `stop()` and the `exit` handler, and may run when no file was ever written (early spawn
  failure) or when it was already removed.
- The existing ready-path spawner tests reach the resolve branch; with the REAL default helpers
  they would litter real pid files under `tmpdir()` — those tests must inject no-op
  `writePid`/`removePid`.
- Model swap / concurrent dashboards: one file per port; `ensure()`'s `stop()` removes the prior
  port's file on swap.
- Criterion "kill -9 node → `pgrep llama-server` empty" is a MANUAL/integration check (a human
  starts the dashboard, does one `ask`, `kill -9`s node, runs the hook) — it is NOT automated
  here; unit tests must not spawn real processes.

## Tasks

- [ ] Create `src/server-pids.ts` and refactor `src/server.ts` to use it (behavior-preserving). New file `src/server-pids.ts` exports: `export const PID_DIR = join(tmpdir(), 'pr-map-server-pids');` (import `tmpdir` from `node:os`, `join`/`dirname` from `node:path`); `export function writePidFile(pidFilePath: string, pid: number): void` that, wrapped in a `try/catch` that swallows errors, does `mkdirSync(dirname(pidFilePath), { recursive: true })` then `writeFileSync(pidFilePath, String(pid))` (import `mkdirSync`/`writeFileSync`/`rmSync` from `node:fs`); and `export function removePidFile(pidFilePath: string): void` that, in a `try/catch` swallowing errors, does `rmSync(pidFilePath, { force: true })`. Then edit `src/server.ts`: delete the local `const PID_DIR = ...` (line 27) and import `{ PID_DIR, writePidFile, removePidFile }` from `./server-pids.js`; replace the inline `mkdirSync(PID_DIR, { recursive: true })` + `writeFileSync(pidFile, String(process.pid))` block with a single `writePidFile(pidFile, process.pid)` (the helper is already best-effort — you may drop the now-redundant surrounding try/catch, keeping the same non-fatal behavior); replace the `rmSync(pidFile, { force: true })` in `registerGracefulShutdown` with `removePidFile(pidFile)`; remove `mkdirSync, rmSync, writeFileSync` from the `node:fs` import on line 4 (KEEP `existsSync`, still used at line 34); and remove `tmpdir` from the `node:os` import on line 5 (KEEP `homedir`, still used at line 143) since deleting `PID_DIR` removes its only use — `@typescript-eslint/no-unused-vars` is an error, so leaving it would fail the lint gate. Do NOT change `registerGracefulShutdown`'s signature or the startup order. Write `src/server-pids.test.ts` (Vitest, following the style of `src/llama-runner.test.ts`): create a unique temp dir with `mkdtempSync(join(tmpdir(), 'pr-map-pids-'))`; assert (a) `writePidFile(join(dir, 'sub', '123.pid'), 123)` creates the missing parent dir and the file contains `'123'`; (b) `removePidFile` deletes an existing file; (c) `removePidFile` on a non-existent path does NOT throw; (d) `writePidFile` to an un-writable path (e.g. a path whose parent is an existing regular file) does NOT throw (best-effort). Run `npm test`.

- [ ] Now that `src/server-pids.ts` exists, track the llama-server child PID in the spawner. In `src/llama-runner.ts`: import `{ PID_DIR, writePidFile, removePidFile }` from `./server-pids.js` (`join` is already imported from `node:path`). Extend `LlamaSpawnerDeps` with two optional seams: `writePid?: (pidFilePath: string, pid: number) => void;` and `removePid?: (pidFilePath: string) => void;`, and in `createLlamaSpawner` default them to `deps.writePid ?? writePidFile` and `deps.removePid ?? removePidFile`. In the returned spawner, immediately AFTER the spawn `try/catch` block (after line 64, in the outer function scope — NOT inside the `try` — so it is visible to the Promise executor below), and before the `return new Promise(...)`, compute `const pidFilePath = join(PID_DIR, `${port}-llama.pid`);` and, guarded by `if (child.pid !== undefined)`, call `writePid(pidFilePath, child.pid)`. Add a `child.on('exit', () => removePid(pidFilePath));` listener (in ADDITION to the existing early-exit error handler — do not remove or alter that one). Change the ready-path resolve from `stop: () => child.kill()` to `stop: () => { child.kill(); removePid(pidFilePath); }`. Do NOT write the pid file in the health-ok branch, and do NOT change the spawn flags, health polling, timeout, or error resolution. Extend `src/llama-runner.test.ts`: add tests that inject fake `writePid`/`removePid` spies (arrays recording their args) alongside the existing fake `spawn`/`fetchFn`/`pickPort` that drive a spawn to READY, and assert: (a) `writePid` was called once with a `pidFilePath` ending in `${port}-llama.pid` and the fake child's `pid`; (b) calling the resolved `RunningServer.stop()` calls `removePid` with that same path; (c) emitting the fake child's `exit` event calls `removePid` with that path. ALSO update any EXISTING spawner test that reaches the ready path to pass no-op `writePid: () => {}` / `removePid: () => {}` in its deps so it does not write real pid files under `tmpdir()`. Run `npm test`.

- [ ] Run full verification and fix any failures: `npm test`, `npm run lint`, `npm run typecheck`. Note that the acceptance criterion "start the dashboard, trigger one `ask`, `kill -9` the node server, run the SessionEnd hook → `pgrep llama-server` returns nothing" is a MANUAL integration check performed by a human — do NOT attempt to automate it by spawning real processes.
