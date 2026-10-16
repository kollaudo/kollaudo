// Fails when a link inside the built site points to a page or a heading that doesn't exist.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "pagefind" ? [] : pages(file);
    return entry.name.endsWith(".html") ? [file] : [];
  });
}

function fileOf(url) {
  const file = path.join(dist, url);
  if (existsSync(file) && !file.endsWith(path.sep)) {
    const direct = path.join(file, "index.html");
    return existsSync(direct) ? direct : file;
  }
  return path.join(file, "index.html");
}

const ids = new Map();
function idsOf(file) {
  if (!ids.has(file)) {
    const html = readFileSync(file, "utf8");
    ids.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])));
  }
  return ids.get(file);
}

const broken = [];
for (const page of pages(dist)) {
  const html = readFileSync(page, "utf8");
  for (const [, href] of html.matchAll(/\shref="([^"]+)"/g)) {
    if (!href.startsWith("/") && !href.startsWith("#")) continue;
    const [url = "", hash] = href.split("#");
    const target = url === "" ? page : fileOf(decodeURI(url));
    if (!existsSync(target)) broken.push(`${path.relative(dist, page)}: ${href}`);
    else if (hash && !idsOf(target).has(hash))
      broken.push(`${path.relative(dist, page)}: ${href} (no such heading)`);
  }
}

if (broken.length > 0) {
  console.error(`Broken links:\n${[...new Set(broken)].map((link) => `  ${link}`).join("\n")}`);
  process.exit(1);
}
console.log(`Checked the links of ${pages(dist).length} pages.`);
