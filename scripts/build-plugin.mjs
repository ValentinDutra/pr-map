import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const distDir = 'pr-map-plugin/dist';
const dashboardOut = 'pr-map-plugin/dashboard-dist';

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: {
    cli: 'src/cli.ts',
    server: 'src/server.ts',
    merge: 'src/merge-enrichment.ts',
    enrich: 'src/enrich.ts',
    'pr-map': 'src/pr-map.ts',
  },
  outdir: distDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
});

await rm(dashboardOut, { recursive: true, force: true });
await cp('dashboard/dist', dashboardOut, { recursive: true });

console.log(`built ${distDir}/{cli,server,merge,enrich,pr-map}.js and ${dashboardOut}/`);
