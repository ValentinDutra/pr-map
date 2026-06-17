import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

// Bundles the deterministic runtime into self-contained node scripts inside the plugin, so an
// installed plugin runs with plain `node` (no npm install, no tsx). Run after the dashboard build.
const distDir = 'pr-map-plugin/dist';
const dashboardOut = 'pr-map-plugin/dashboard-dist';

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: {
    cli: 'src/cli.ts',
    server: 'src/server.ts',
    merge: 'src/merge-enrichment.ts',
  },
  outdir: distDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Provide `require` for any CJS dependency (express/open) that calls require at runtime.
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
});

await rm(dashboardOut, { recursive: true, force: true });
await cp('dashboard/dist', dashboardOut, { recursive: true });

console.log(`built ${distDir}/{cli,server,merge}.js and ${dashboardOut}/`);
