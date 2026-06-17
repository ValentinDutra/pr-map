import { resolve } from 'node:path';
import { createGhClient, createDefaultExecutor } from './gh-client.js';
import { fetchPr, writeRaw, workingDirKey } from './fetch-pr.js';
import { assembleGraph, writeGraph } from './build-graph.js';
import { createGitGrep, createReadContent, listRepoFiles } from './repo-scan.js';
import { isOk } from './result.js';

// Deterministic half of the /pr-map pipeline: fetch the PR, build the static graph,
// and write graph.json. The agent enriches that file (summaries + why + llm edges)
// afterwards, then starts the server. Prints a JSON line with the data dir on success.
async function main(): Promise<void> {
  const ref = process.argv[2] ?? '';
  const repoRoot = resolve(process.argv[3] ?? process.cwd());

  // gh resolves {owner}/{repo} from the current directory's git remote, and git grep
  // runs against the checked-out PR, so operate from inside the target repo.
  process.chdir(repoRoot);

  const ghClient = createGhClient(createDefaultExecutor());

  const fetched = await fetchPr(ghClient, ref);
  if (!isOk(fetched)) {
    console.error(`pr-map: ${fetched.error.message}`);
    process.exit(1);
  }
  const rawPr = fetched.value;

  await writeRaw(rawPr, repoRoot);

  const repoFiles = listRepoFiles(repoRoot);
  const gitGrep = createGitGrep(repoRoot);
  const readContent = createReadContent(repoRoot);
  const generatedAt = new Date().toISOString();
  const graph = assembleGraph(rawPr, repoFiles, gitGrep, readContent, generatedAt);

  const written = await writeGraph(graph, repoRoot);
  if (!isOk(written)) {
    console.error(`pr-map: ${written.error.message}`);
    process.exit(1);
  }

  const dataDir = resolve(repoRoot, '.pr-map', workingDirKey(rawPr.meta));
  console.log(
    JSON.stringify({
      dataDir,
      graphPath: written.value,
      prNumber: rawPr.meta.number,
      title: rawPr.meta.title,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
