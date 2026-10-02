// Draws the contributors of the repository as an SVG of round avatars, for the README. Bots and the logins in
// .github/contributors-ignore are left out. Avatars are embedded, since an SVG shown as an image can't
// load other images.
//
//   node .github/scripts/contributors.mjs <output.svg>
//
// GITHUB_REPOSITORY (default kollaudo/kollaudo) and GITHUB_TOKEN, to avoid rate limits, are optional.

import { readFile, writeFile } from "node:fs/promises";

const repo = process.env.GITHUB_REPOSITORY ?? "kollaudo/kollaudo";
const output = process.argv[2];
if (!output) throw new Error("Give the path of the SVG to write.");

const headers = { accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const ignored = new Set(
  (await readFile(new URL("../contributors-ignore", import.meta.url), "utf8"))
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith("#")),
);

const response = await fetch(`https://api.github.com/repos/${repo}/contributors?per_page=100`, {
  headers,
});
if (!response.ok) throw new Error(`GitHub answered ${response.status} for the contributors.`);
const people = (await response.json()).filter(
  (c) => c.type !== "Bot" && !c.login.endsWith("[bot]") && !ignored.has(c.login.toLowerCase()),
);

const COLUMNS = 10;
const AVATAR = 64;
const CELL = AVATAR + 16;

const xml = (text) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function avatar(url) {
  const image = await fetch(`${url}${url.includes("?") ? "&" : "?"}s=${AVATAR * 2}`);
  if (!image.ok) throw new Error(`GitHub answered ${image.status} for an avatar.`);
  const type = image.headers.get("content-type") ?? "image/png";
  return `data:${type};base64,${Buffer.from(await image.arrayBuffer()).toString("base64")}`;
}

const style = `
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: #59636E; }
    .ring { fill: none; stroke: #D0D7DE; }
    @media (prefers-color-scheme: dark) { text { fill: #9198A1; } .ring { stroke: #3D444D; } }`;

let svg;
if (people.length === 0) {
  svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 48" width="480" height="48" role="img" aria-label="No contributors yet">
  <style>${style}</style>
  <text x="240" y="29" text-anchor="middle" font-size="14">Your name could be here: see the good first issues.</text>
</svg>
`;
} else {
  const columns = Math.min(people.length, COLUMNS);
  const width = columns * CELL;
  const height = Math.ceil(people.length / COLUMNS) * CELL;
  // Names are in the label of the image, for screen readers: the README shows only the faces.
  const cells = await Promise.all(
    people.map(async (person, i) => {
      const cx = (i % COLUMNS) * CELL + CELL / 2;
      const top = Math.floor(i / COLUMNS) * CELL + 8;
      return `  <g>
    <clipPath id="c${i}"><circle cx="${cx}" cy="${top + AVATAR / 2}" r="${AVATAR / 2}"/></clipPath>
    <image href="${await avatar(person.avatar_url)}" x="${cx - AVATAR / 2}" y="${top}" width="${AVATAR}" height="${AVATAR}" clip-path="url(#c${i})"/>
    <circle class="ring" cx="${cx}" cy="${top + AVATAR / 2}" r="${AVATAR / 2 - 0.5}"/>
  </g>`;
    }),
  );
  svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Contributors: ${people.map((p) => xml(p.login)).join(", ")}">
  <style>${style}</style>
${cells.join("\n")}
</svg>
`;
}

await writeFile(output, svg);
console.log(`${people.length} contributors drawn in ${output}.`);
