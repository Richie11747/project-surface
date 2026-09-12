/**
 * Linking tests to the code they prove.
 *
 * This is the part that separates an evidence graph from a filename heuristic.
 * If a test file imports the implementation file, the connection is a fact
 * recorded in the source; that is emitted as `import-graph`. If the two files
 * merely have similar names, that is a guess, and it is emitted as
 * `path-proximity` so a consumer can weigh it accordingly.
 *
 * Module resolution here is deliberately simple - relative specifiers only,
 * with the extension rewrites the ecosystem actually uses. A bare specifier is
 * a dependency, not a link to project code.
 */

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_FILES = SOURCE_EXTENSIONS.map((ext) => `index${ext}`);

export const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
export const TEST_DIR_PATTERN = /(^|\/)(tests?|__tests__|spec)\//;

export function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERN.test(path) || (TEST_DIR_PATTERN.test(path) && isSourceFile(path));
}

export function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** Normalize `a/b/../c` to `a/c` without touching the filesystem. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/**
 * Resolve a relative import to a project file, mirroring the extension
 * rewriting that TypeScript and Node ESM perform.
 */
export function resolveImport(
  fromPath: string,
  specifier: string,
  files: ReadonlySet<string>
): string | null {
  if (!specifier.startsWith(".")) return null;

  const base = normalize(`${dirname(fromPath)}/${specifier}`);
  const candidates: string[] = [base];

  /* `./create.js` in ESM TypeScript means `./create.ts` on disk. */
  const jsExtension = /\.(js|jsx|mjs|cjs)$/.exec(base);
  if (jsExtension) {
    const stem = base.slice(0, -jsExtension[0].length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
  }

  if (!/\.[a-z]+$/.test(base)) {
    for (const ext of SOURCE_EXTENSIONS) candidates.push(`${base}${ext}`);
  }
  for (const index of INDEX_FILES) candidates.push(`${base}/${index}`);

  return candidates.find((c) => files.has(c)) ?? null;
}

/** Strip `.test`/`.spec` and the extension: `create.test.ts` -> `create`. */
function testStem(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(TEST_FILE_PATTERN, "").replace(/\.[a-z]+$/, "");
}

function sourceStem(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.[a-z]+$/, "");
}

export interface TestFile {
  path: string;
  imports: string[];
}

export interface LinkedEvidence {
  ownerPath: string;
  testPath: string;
  link: "import-graph" | "path-proximity";
}

/**
 * Produce one link per (owner, test) pair, preferring the strong signal. A test
 * that both imports a file and sits next to it is reported once, as an import.
 */
export function linkTests(
  tests: TestFile[],
  sourceFiles: ReadonlySet<string>,
  allFiles: ReadonlySet<string>
): LinkedEvidence[] {
  const links = new Map<string, LinkedEvidence>();
  const key = (owner: string, test: string): string => `${owner}\u0000${test}`;

  for (const test of tests) {
    for (const specifier of test.imports) {
      const resolved = resolveImport(test.path, specifier, allFiles);
      if (resolved && sourceFiles.has(resolved) && resolved !== test.path) {
        links.set(key(resolved, test.path), {
          ownerPath: resolved,
          testPath: test.path,
          link: "import-graph",
        });
      }
    }
  }

  /* Only fall back to name matching for tests that resolved nothing at all.
     A test with real imports has already told us what it covers. */
  const byStem = new Map<string, string[]>();
  for (const path of sourceFiles) {
    const stem = sourceStem(path);
    byStem.set(stem, [...(byStem.get(stem) ?? []), path]);
  }

  for (const test of tests) {
    const alreadyLinked = [...links.values()].some((l) => l.testPath === test.path);
    if (alreadyLinked) continue;

    const matches = byStem.get(testStem(test.path)) ?? [];
    /* An ambiguous name match is not evidence of anything. */
    if (matches.length !== 1) continue;
    const owner = matches[0];
    if (!owner || owner === test.path) continue;
    links.set(key(owner, test.path), {
      ownerPath: owner,
      testPath: test.path,
      link: "path-proximity",
    });
  }

  return [...links.values()].sort(
    (a, b) => a.ownerPath.localeCompare(b.ownerPath) || a.testPath.localeCompare(b.testPath)
  );
}
