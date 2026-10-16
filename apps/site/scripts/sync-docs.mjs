// Publishes `docs/` on the site without copying it by hand. The files stay where they are, and
// this script writes the version Starlight reads to `src/content/docs/docs/` (not in git):
// - the first `# Heading` becomes the page title, because Starlight needs one in the frontmatter;
// - relative links between pages become site links;
// - links to anything else in the repository, such as a recipe's YAML, become GitHub links.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const docs = path.join(repo, "docs");
const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The pages are published under `/docs/`, and `/` is the landing page.
const out = path.join(site, "src/content/docs/docs");
const github = "https://github.com/kollaudo/kollaudo";

// brand.md is about the repository's images, which the site doesn't publish.
const skipped = new Set(["brand.md"]);

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(file);
    return entry.name.endsWith(".md") && !skipped.has(path.relative(docs, file)) ? [file] : [];
  });
}

// `adr/README.md` is the page of `adr/`: the site is at `/adr/`.
function route(file) {
  const rel = path.relative(docs, file).replace(/\.md$/, "");
  return rel.replace(/(^|\/)README$/, "");
}

const files = markdownFiles(docs);
const published = new Set(files.map((file) => path.resolve(file)));
const problems = [];

function rewrite(target, from) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return target;
  const [rawPath, hash] = target.split("#");
  const resolved = path.resolve(path.dirname(from), rawPath);
  const suffix = hash ? `#${hash}` : "";
  if (published.has(resolved))
    return `/docs/${route(resolved)}${route(resolved) ? "/" : ""}${suffix}`;
  if (!existsSync(resolved)) {
    problems.push(`${path.relative(repo, from)}: ${target} doesn't exist`);
    return target;
  }
  const rel = path.relative(repo, resolved);
  const kind = statSync(resolved).isDirectory() ? "tree" : "blob";
  return `${github}/${kind}/main/${rel}${suffix}`;
}

function convert(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  let title;
  let fenced = false;
  const body = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && title === undefined && /^# /.test(line)) {
      title = line.slice(2).trim();
      continue;
    }
    body.push(
      fenced || /^\s*(```|~~~)/.test(line)
        ? line
        : line.replace(/\]\(([^)\s]+)\)/g, (_, target) => `](${rewrite(target, file)})`),
    );
  }
  const rel = path.relative(repo, file);
  const front = [
    "---",
    `title: ${JSON.stringify(title ?? path.basename(file, ".md"))}`,
    // Without it, Astro would turn `v0.5` into `v05`, and the links to it would break.
    `slug: ${JSON.stringify(`docs/${route(file)}`)}`,
    `editUrl: ${JSON.stringify(`${github}/edit/main/${rel}`)}`,
    "---",
    "",
  ];
  return front.join("\n") + body.join("\n").replace(/^\n+/, "");
}

rmSync(out, { recursive: true, force: true });
for (const file of files) {
  const rel = path.relative(docs, file);
  const dest = path.join(out, rel.replace(/(^|\/)README\.md$/, "$1index.md"));
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, convert(file));
}

// The favicon is the one of the web UI.
mkdirSync(path.join(site, "public"), { recursive: true });
copyFileSync(path.join(repo, "apps/web/public/logo.svg"), path.join(site, "public/favicon.svg"));

// The home of the documentation is written by hand, in `docs-home.md`.
writeFileSync(path.join(out, "index.md"), readFileSync(path.join(site, "docs-home.md"), "utf8"));

if (problems.length > 0) {
  console.error(`Broken links in docs/:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`Synced ${files.length} pages from docs/.`);
