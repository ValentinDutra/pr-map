import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);

// src/cli.ts
import { resolve } from "node:path";

// src/gh-client.ts
import { spawn } from "node:child_process";

// src/result.ts
function ok(value) {
  return { ok: true, value };
}
function err(error) {
  return { ok: false, error };
}
function isOk(result) {
  return result.ok;
}

// src/retry.ts
async function retry(operation, options) {
  const totalAttempts = Math.max(1, options.attempts);
  let lastResult = await operation();
  let attemptsMade = 1;
  while (!isOk(lastResult) && attemptsMade < totalAttempts) {
    if (options.delayMs > 0) {
      await delay(options.delayMs);
    }
    lastResult = await operation();
    attemptsMade += 1;
  }
  return lastResult;
}
function delay(milliseconds) {
  return new Promise((resolve2) => setTimeout(resolve2, milliseconds));
}

// src/gh-client.ts
var DEFAULT_RETRY_OPTIONS = { attempts: 3, delayMs: 300 };
var PR_METADATA_FIELDS = "number,title,body,author,baseRefName,headRefName,url";
function createGhClient(execute, retryOptions = DEFAULT_RETRY_OPTIONS) {
  const run = (args, stdin) => retry(() => execute(args, stdin), retryOptions);
  return {
    async getPrMetadata(ref) {
      const args = ["pr", "view"];
      if (ref) args.push(ref);
      args.push("--json", PR_METADATA_FIELDS);
      const raw = await run(args);
      if (!isOk(raw)) return raw;
      return parsePrMetadata(raw.value);
    },
    async listChangedFiles(prNumber) {
      const raw = await run([
        "api",
        `repos/{owner}/{repo}/pulls/${prNumber}/files`,
        "--paginate"
      ]);
      if (!isOk(raw)) return raw;
      return parseChangedFiles(raw.value);
    },
    getDiff(ref) {
      const args = ["pr", "diff"];
      if (ref) args.push(ref);
      return run(args);
    },
    getFileContent(path2, ref) {
      const encodedPath = path2.split("/").map(encodeURIComponent).join("/");
      return run([
        "api",
        `repos/{owner}/{repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
        "-H",
        "Accept: application/vnd.github.raw"
      ]);
    },
    createReview(prNumber, submission) {
      return run(
        [
          "api",
          `repos/{owner}/{repo}/pulls/${prNumber}/reviews`,
          "--method",
          "POST",
          "--input",
          "-"
        ],
        JSON.stringify({
          event: submission.event,
          body: submission.body ?? "",
          comments: submission.comments
        })
      );
    },
    replyToComment(prNumber, commentId, body) {
      return run(
        [
          "api",
          `repos/{owner}/{repo}/pulls/${prNumber}/comments/${commentId}/replies`,
          "--method",
          "POST",
          "--input",
          "-"
        ],
        JSON.stringify({ body })
      );
    }
  };
}
function parsePrMetadata(raw) {
  const parsed = parseJson(raw);
  if (!isOk(parsed)) return parsed;
  const location = parseRepoFromUrl(parsed.value.url);
  if (!isOk(location)) return location;
  return ok({
    owner: location.value.owner,
    repo: location.value.repo,
    number: parsed.value.number,
    title: parsed.value.title,
    description: parsed.value.body ?? "",
    author: parsed.value.author?.login ?? "",
    baseRef: parsed.value.baseRefName,
    headRef: parsed.value.headRefName
  });
}
function parseChangedFiles(raw) {
  const parsed = parseJson(raw);
  if (!isOk(parsed)) return parsed;
  return ok(
    parsed.value.map((file) => ({
      path: file.filename,
      status: mapStatus(file.status),
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
      previousPath: file.previous_filename
    }))
  );
}
function mapStatus(githubStatus) {
  switch (githubStatus) {
    case "added":
      return "added";
    case "removed":
      return "deleted";
    case "renamed":
      return "renamed";
    default:
      return "modified";
  }
}
function parseRepoFromUrl(url) {
  const match = /([^/]+)\/([^/]+)\/pull\/\d+/.exec(url);
  if (!match) {
    return err({ message: `Could not parse owner/repo from PR url: ${url}` });
  }
  return ok({ owner: match[1], repo: match[2] });
}
function parseJson(raw) {
  try {
    return ok(JSON.parse(raw));
  } catch (error) {
    return err({
      message: `Failed to parse gh JSON output: ${error.message}`
    });
  }
}
function createDefaultExecutor() {
  return (args, stdin) => new Promise((resolve2) => {
    const child = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => resolve2(err({ message: error.message })));
    child.on("close", (code) => {
      if (code === 0) {
        resolve2(ok(stdout));
      } else {
        resolve2(
          err({
            message: `gh ${args.join(" ")} exited with code ${code ?? "null"}`,
            stderr,
            exitCode: code ?? void 0
          })
        );
      }
    });
    child.stdin.on("error", () => void 0);
    if (stdin !== void 0) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

// src/fetch-pr.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
function workingDirKey(meta) {
  return `${meta.owner}-${meta.repo}-${meta.number}`;
}
async function fetchPr(ghClient, ref) {
  const metaResult = await ghClient.getPrMetadata(ref);
  if (!isOk(metaResult)) {
    return err(toFetchError("Failed to load PR metadata", metaResult.error));
  }
  const meta = metaResult.value;
  const filesResult = await ghClient.listChangedFiles(meta.number);
  if (!isOk(filesResult)) {
    return err(toFetchError("Failed to list changed files", filesResult.error));
  }
  const diffResult = await ghClient.getDiff(ref);
  if (!isOk(diffResult)) {
    return err(toFetchError("Failed to load PR diff", diffResult.error));
  }
  const files = [];
  for (const file of filesResult.value) {
    const rawFile = {
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
      previousPath: file.previousPath
    };
    if (file.status !== "deleted") {
      const contentResult = await ghClient.getFileContent(file.path, meta.headRef);
      if (isOk(contentResult)) {
        rawFile.content = contentResult.value;
      }
    }
    files.push(rawFile);
  }
  return ok({ meta, files, diff: diffResult.value });
}
async function writeRaw(rawPr, workingDir) {
  const directory = join(workingDir, ".pr-map", workingDirKey(rawPr.meta));
  try {
    await mkdir(directory, { recursive: true });
    const filePath = join(directory, "raw.json");
    await writeFile(filePath, JSON.stringify(rawPr, null, 2), "utf8");
    return ok(filePath);
  } catch (error) {
    return err({ message: `Failed to write raw.json: ${error.message}` });
  }
}
function toFetchError(message, cause) {
  return { message: `${message}: ${cause.message}`, cause };
}

// src/build-graph.ts
import { mkdir as mkdir2, writeFile as writeFile2 } from "node:fs/promises";
import { join as join2 } from "node:path";

// src/import-rules.ts
import { posix as path } from "node:path";
var JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
var javascriptRule = {
  language: "javascript/typescript",
  extensions: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
  extractSpecifiers(content) {
    const specifiers = [];
    const patterns = [
      /import\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
      /export\s+[^'"()]*?\s+from\s+['"]([^'"]+)['"]/g,
      /require\(\s*['"]([^'"]+)['"]\s*\)/g,
      /import\(\s*['"]([^'"]+)['"]\s*\)/g
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        specifiers.push(match[1]);
      }
    }
    return specifiers;
  },
  resolve(specifier, fromPath, repoFiles) {
    if (!specifier.startsWith(".")) return [];
    const cleanSpecifier = specifier.replace(/[?#].*$/, "");
    const base = path.normalize(path.join(path.dirname(fromPath), cleanSpecifier));
    const stem = base.replace(/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/, "");
    const candidates = [
      base,
      ...JS_EXTENSIONS.map((extension) => `${stem}${extension}`),
      ...JS_EXTENSIONS.map((extension) => path.join(stem, `index${extension}`))
    ];
    return candidates.filter((candidate) => repoFiles.has(candidate));
  }
};
var pythonRule = {
  language: "python",
  extensions: ["py"],
  extractSpecifiers(content) {
    const specifiers = [];
    const patterns = [/^\s*from\s+([.\w]+)\s+import\s+/gm, /^\s*import\s+([.\w]+)/gm];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        specifiers.push(match[1]);
      }
    }
    return specifiers;
  },
  resolve(specifier, fromPath, repoFiles) {
    let modulePath;
    if (specifier.startsWith(".")) {
      const leadingDots = (/^\.+/.exec(specifier) ?? [""])[0].length;
      const rest = specifier.slice(leadingDots).replace(/\./g, "/");
      let baseDirectory = path.dirname(fromPath);
      for (let level = 1; level < leadingDots; level += 1) {
        baseDirectory = path.dirname(baseDirectory);
      }
      modulePath = rest ? path.join(baseDirectory, rest) : baseDirectory;
    } else {
      modulePath = specifier.replace(/\./g, "/");
    }
    const candidates = [`${modulePath}.py`, path.join(modulePath, "__init__.py")];
    return candidates.filter((candidate) => repoFiles.has(candidate));
  }
};
var goRule = {
  language: "go",
  extensions: ["go"],
  extractSpecifiers(content) {
    const specifiers = [];
    const groupPattern = /import\s*\(([\s\S]*?)\)/g;
    let groupMatch;
    while ((groupMatch = groupPattern.exec(content)) !== null) {
      const linePattern = /(?:[.\w]+\s+)?"([^"]+)"/g;
      let lineMatch;
      while ((lineMatch = linePattern.exec(groupMatch[1])) !== null) {
        specifiers.push(lineMatch[1]);
      }
    }
    const singlePattern = /^\s*import\s+(?:[.\w]+\s+)?"([^"]+)"/gm;
    let singleMatch;
    while ((singleMatch = singlePattern.exec(content)) !== null) {
      specifiers.push(singleMatch[1]);
    }
    return specifiers;
  },
  resolve(specifier, _fromPath, repoFiles) {
    const importPath = specifier.replace(/\/+$/, "");
    if (!importPath) return [];
    const targets = [];
    for (const candidate of repoFiles) {
      if (!candidate.endsWith(".go")) continue;
      const directory = path.dirname(candidate);
      if (directory === importPath || directory.endsWith(`/${importPath}`)) {
        targets.push(candidate);
      }
    }
    return targets;
  }
};
var JVM_EXTENSIONS_BY_RULE = ["java", "kt"];
var javaKotlinRule = {
  language: "java/kotlin",
  extensions: ["java", "kt", "kts"],
  extractSpecifiers(content) {
    const specifiers = [];
    const pattern = /^\s*import\s+(?!static\s)(\w+(?:\.\w+)*(?:\.\*)?)\s*;?/gm;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
    return specifiers;
  },
  resolve(specifier, _fromPath, repoFiles) {
    if (specifier.endsWith(".*")) {
      const packageDirectory = specifier.slice(0, -2).replace(/\./g, "/");
      if (!packageDirectory) return [];
      const targets2 = [];
      for (const candidate of repoFiles) {
        const isJvmSource = JVM_EXTENSIONS_BY_RULE.some(
          (extension) => candidate.endsWith(`.${extension}`)
        );
        if (!isJvmSource) continue;
        const directory = path.dirname(candidate);
        if (directory === packageDirectory || directory.endsWith(`/${packageDirectory}`)) {
          targets2.push(candidate);
        }
      }
      return targets2;
    }
    const relativePath = specifier.replace(/\./g, "/");
    const targets = [];
    for (const extension of JVM_EXTENSIONS_BY_RULE) {
      const suffix = `${relativePath}.${extension}`;
      for (const candidate of repoFiles) {
        if (candidate === suffix || candidate.endsWith(`/${suffix}`)) {
          targets.push(candidate);
        }
      }
    }
    return targets;
  }
};
var rubyRule = {
  language: "ruby",
  extensions: ["rb"],
  extractSpecifiers(content) {
    const specifiers = [];
    const relativePattern = /^\s*require_relative\s+['"]([^'"]+)['"]/gm;
    let relativeMatch;
    while ((relativeMatch = relativePattern.exec(content)) !== null) {
      specifiers.push(`require_relative:${relativeMatch[1]}`);
    }
    const requirePattern = /^\s*require\s+['"]([^'"]+)['"]/gm;
    let requireMatch;
    while ((requireMatch = requirePattern.exec(content)) !== null) {
      specifiers.push(requireMatch[1]);
    }
    return specifiers;
  },
  resolve(specifier, fromPath, repoFiles) {
    if (specifier.startsWith("require_relative:")) {
      const relativeName = specifier.slice("require_relative:".length);
      const stem2 = relativeName.replace(/\.rb$/, "");
      const resolved = path.normalize(path.join(path.dirname(fromPath), `${stem2}.rb`));
      return repoFiles.has(resolved) ? [resolved] : [];
    }
    const stem = specifier.replace(/\.rb$/, "");
    const suffix = `${stem}.rb`;
    const targets = [];
    for (const candidate of repoFiles) {
      if (candidate === suffix || candidate.endsWith(`/${suffix}`)) {
        targets.push(candidate);
      }
    }
    return targets;
  }
};
var rustRule = {
  language: "rust",
  extensions: ["rs"],
  extractSpecifiers(content) {
    const specifiers = [];
    const modPattern = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;
    let modMatch;
    while ((modMatch = modPattern.exec(content)) !== null) {
      specifiers.push(`mod:${modMatch[1]}`);
    }
    const usePattern = /^\s*(?:pub\s+)?use\s+((?:crate|super|self)::[\w:]+)/gm;
    let useMatch;
    while ((useMatch = usePattern.exec(content)) !== null) {
      specifiers.push(useMatch[1]);
    }
    return specifiers;
  },
  resolve(specifier, fromPath, repoFiles) {
    const directory = path.dirname(fromPath);
    if (specifier.startsWith("mod:")) {
      const moduleName = specifier.slice("mod:".length);
      const candidates = [
        path.join(directory, `${moduleName}.rs`),
        path.join(directory, moduleName, "mod.rs")
      ];
      return candidates.filter((candidate) => repoFiles.has(candidate));
    }
    const segments = specifier.split("::");
    const withoutRoot = segments.slice(1, -1);
    if (withoutRoot.length === 0) return [];
    const modulePath = withoutRoot.join("/");
    const suffixes = [`${modulePath}.rs`, `${modulePath}/mod.rs`];
    const targets = [];
    for (const suffix of suffixes) {
      for (const candidate of repoFiles) {
        if (candidate === suffix || candidate.endsWith(`/${suffix}`)) {
          targets.push(candidate);
        }
      }
    }
    return targets;
  }
};
var IMPORT_RULES = [
  javascriptRule,
  pythonRule,
  goRule,
  javaKotlinRule,
  rubyRule,
  rustRule
];
function findRule(filePath) {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot < 0) return void 0;
  const extension = filePath.slice(lastDot + 1).toLowerCase();
  return IMPORT_RULES.find((rule) => rule.extensions.includes(extension));
}

// src/build-graph.ts
var LANGUAGE_BY_EXTENSION = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "css",
  html: "html",
  go: "go",
  rs: "rust",
  rb: "ruby",
  java: "java",
  yml: "yaml",
  yaml: "yaml",
  sh: "shell",
  sql: "sql"
};
function detectLanguage(path2) {
  const lastDot = path2.lastIndexOf(".");
  const lastSlash = path2.lastIndexOf("/");
  if (lastDot < 0 || lastDot < lastSlash) return "unknown";
  const extension = path2.slice(lastDot + 1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? extension;
}
function buildNodes(rawPr) {
  return rawPr.files.map((file) => ({
    id: file.path,
    path: file.path,
    language: detectLanguage(file.path),
    inPr: true,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
    summary: ""
  }));
}
function ensureNeighbor(nodesById, targetPath) {
  if (nodesById.has(targetPath)) return;
  nodesById.set(targetPath, {
    id: targetPath,
    path: targetPath,
    language: detectLanguage(targetPath),
    inPr: false
  });
}
function addEdge(edgesById, edge) {
  const id = `${edge.source}->${edge.target}:${edge.kind}:${edge.direction}`;
  if (!edgesById.has(id)) {
    edgesById.set(id, { id, ...edge });
  }
}
function addOutgoingEdges(nodes, rawPr, repoFiles) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgesById = /* @__PURE__ */ new Map();
  for (const file of rawPr.files) {
    if (file.content === void 0) continue;
    const rule = findRule(file.path);
    if (!rule) continue;
    for (const specifier of rule.extractSpecifiers(file.content)) {
      for (const target of rule.resolve(specifier, file.path, repoFiles)) {
        if (target === file.path) continue;
        ensureNeighbor(nodesById, target);
        addEdge(edgesById, {
          source: file.path,
          target,
          kind: "import",
          direction: "outgoing",
          origin: "static",
          confidence: 1
        });
      }
    }
  }
  return { nodes: [...nodesById.values()], edges: [...edgesById.values()] };
}
function importPatternsFor(prPath) {
  const withoutExtension = prPath.replace(/\.[^./]+$/, "");
  const baseName = withoutExtension.slice(withoutExtension.lastIndexOf("/") + 1);
  const dottedModule = withoutExtension.replace(/\//g, ".");
  return [.../* @__PURE__ */ new Set([withoutExtension, baseName, dottedModule])].filter(
    (pattern) => pattern.length > 0
  );
}
function addIncomingEdges(nodes, prFiles, repoFiles, gitGrep, readContent) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgesById = /* @__PURE__ */ new Map();
  const prFileSet = new Set(prFiles.map((file) => file.path));
  for (const prFile of prFiles) {
    const targetPath = prFile.path;
    const names = prFile.previousPath ? [prFile.path, prFile.previousPath] : [prFile.path];
    const confirmFiles = new Set(repoFiles);
    for (const name of names) confirmFiles.add(name);
    const candidates = /* @__PURE__ */ new Set();
    for (const name of names) {
      for (const pattern of importPatternsFor(name)) {
        for (const match of gitGrep(pattern)) {
          candidates.add(match);
        }
      }
    }
    for (const candidatePath of candidates) {
      if (candidatePath === targetPath || prFileSet.has(candidatePath)) continue;
      const rule = findRule(candidatePath);
      if (!rule) continue;
      const content = readContent(candidatePath);
      if (content === void 0) continue;
      const resolvedTargets = new Set(
        rule.extractSpecifiers(content).flatMap(
          (specifier) => rule.resolve(specifier, candidatePath, confirmFiles)
        )
      );
      if (!names.some((name) => resolvedTargets.has(name))) continue;
      ensureNeighbor(nodesById, candidatePath);
      addEdge(edgesById, {
        source: candidatePath,
        target: targetPath,
        kind: "import",
        direction: "incoming",
        origin: "static",
        confidence: 1
      });
    }
  }
  return { nodes: [...nodesById.values()], edges: [...edgesById.values()] };
}
function dedupeById(items) {
  const byId = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}
function assembleGraph(rawPr, repoFiles, gitGrep, readContent, generatedAt) {
  const prNodes = buildNodes(rawPr);
  const outgoing = addOutgoingEdges(prNodes, rawPr, repoFiles);
  const incoming = addIncomingEdges(
    outgoing.nodes,
    rawPr.files,
    repoFiles,
    gitGrep,
    readContent
  );
  return {
    meta: rawPr.meta,
    nodes: dedupeById([...outgoing.nodes, ...incoming.nodes]),
    edges: dedupeById([...outgoing.edges, ...incoming.edges]),
    generatedAt
  };
}
async function writeGraph(graph, workingDir) {
  const directory = join2(workingDir, ".pr-map", workingDirKey(graph.meta));
  try {
    await mkdir2(directory, { recursive: true });
    const filePath = join2(directory, "graph.json");
    await writeFile2(filePath, JSON.stringify(graph, null, 2), "utf8");
    return ok(filePath);
  } catch (error) {
    return err({ message: `Failed to write graph.json: ${error.message}` });
  }
}

// src/repo-scan.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join as join3 } from "node:path";
function createGitGrep(repoRoot) {
  return (pattern) => {
    try {
      const output = execFileSync("git", ["grep", "-l", "-F", pattern], {
        cwd: repoRoot,
        encoding: "utf8"
      });
      return output.split("\n").filter((line) => line.length > 0);
    } catch {
      return [];
    }
  };
}
function createReadContent(repoRoot) {
  return (path2) => {
    try {
      return readFileSync(join3(repoRoot, path2), "utf8");
    } catch {
      return void 0;
    }
  };
}
function listRepoFiles(repoRoot) {
  try {
    const output = execFileSync("git", ["ls-files"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    return new Set(output.split("\n").filter((line) => line.length > 0));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}

// src/cli.ts
async function main() {
  const ref = process.argv[2] ?? "";
  const repoRoot = resolve(process.argv[3] ?? process.cwd());
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
  const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const graph = assembleGraph(rawPr, repoFiles, gitGrep, readContent, generatedAt);
  const written = await writeGraph(graph, repoRoot);
  if (!isOk(written)) {
    console.error(`pr-map: ${written.error.message}`);
    process.exit(1);
  }
  const dataDir = resolve(repoRoot, ".pr-map", workingDirKey(rawPr.meta));
  console.log(
    JSON.stringify({
      dataDir,
      graphPath: written.value,
      prNumber: rawPr.meta.number,
      title: rawPr.meta.title,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length
    })
  );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
