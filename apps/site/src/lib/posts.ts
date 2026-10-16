import { getImage } from "astro:assets";
import { type CollectionEntry, getCollection } from "astro:content";
import type { ImageMetadata } from "astro";
import { type Embed, embed, sourceOf } from "./embed";

export interface Post {
  entry: CollectionEntry<"blog" | "announcements">;
  /** Written here, read from a link to another site, or announced in GitHub Discussions. */
  kind: "written" | "linked" | "announcement";
  slug: string;
  title: string;
  date?: Date;
  author?: string;
  /** For a post from another site: where it is, and what the build read from it. */
  source?: { name: string; url: string; link?: string };
  paragraphs: string[];
  /** One paragraph for the list of posts. */
  excerpt?: string;
  images: string[];
  video?: Embed["video"];
  /** The image a video shows before it plays. */
  poster?: string;
}

/** The posts of the blog, newest first. What a file says wins over what is read from its link. */
export async function getPosts(): Promise<Post[]> {
  const entries = await getCollection("blog", (entry) => !entry.data.draft);
  const posts = await Promise.all(entries.map(toPost));
  const written = new Set(posts.map((post) => post.slug));
  // A file in src/content/blog/ with the same name as an announcement takes its place.
  const announced = (await getCollection("announcements"))
    .filter((entry) => !written.has(entry.id))
    .map(toAnnouncement);
  return [...posts, ...announced].sort(
    (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0),
  );
}

function toAnnouncement(entry: CollectionEntry<"announcements">): Post {
  return {
    entry,
    kind: "announcement",
    slug: entry.id,
    title: entry.data.title,
    date: entry.data.date,
    author: entry.data.author,
    source: { name: "GitHub Discussions", url: entry.data.url },
    paragraphs: [],
    excerpt: firstParagraph(entry.body ?? ""),
    images: [],
  };
}

async function toPost(entry: CollectionEntry<"blog">): Promise<Post> {
  const data = entry.data;
  const read = data.link ? await embed(data.link) : undefined;
  const source = data.link
    ? { name: read?.source ?? sourceOf(data.link), url: data.link, link: read?.link }
    : undefined;
  const found = data.video ? videoFile(data.video) : read?.video;
  const video =
    found?.kind === "file" ? { ...found, src: await copyVideo(entry.id, found.src) } : found;
  const title = data.title ?? read?.title ?? `A post on ${source?.name}`;
  // A post often opens with the line that is its title: shown once is enough.
  const paragraphs = data.text
    ? data.text
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
    : data.description
      ? [data.description]
      : (read?.paragraphs ?? []);
  const text = paragraphs
    .map((paragraph, i) =>
      i === 0 && paragraph.startsWith(title) ? paragraph.slice(title.length).trim() : paragraph,
    )
    .filter(Boolean);
  const images = await Promise.all((data.image ? [data.image] : (read?.images ?? [])).map(local));
  return {
    entry,
    kind: data.link ? "linked" : "written",
    slug: entry.id,
    title,
    date: data.date ?? read?.date,
    author: data.author ?? read?.author,
    source,
    paragraphs: text,
    excerpt: data.description ?? text[0] ?? firstParagraph(entry.body ?? ""),
    images,
    video,
    poster: data.poster
      ? await local(data.poster)
      : read?.poster
        ? await local(read.poster)
        : images[0],
  };
}

/**
 * Copies an image into the site when it is built, since the links of some sites, such as LinkedIn,
 * expire. If it can't, the post keeps the link.
 */
async function local(src: string | ImageMetadata): Promise<string> {
  if (typeof src !== "string") return (await getImage({ src })).src;
  try {
    return (await getImage({ src, inferSize: true })).src;
  } catch (error) {
    console.warn(`[blog] Couldn't copy ${src}: ${(error as Error).message}. The post links to it.`);
    return src;
  }
}

const videos = new Map<string, Promise<Uint8Array | undefined>>();

/** Where the video of a post is served from the site, for /blog/media/<post>.mp4. */
export function videoPath(slug: string): string {
  return `/blog/media/${slug.replaceAll("/", "-")}.mp4`;
}

/** The bytes of a video the build copied, by the name in its path. */
export async function videoBytes(name: string): Promise<Uint8Array | undefined> {
  for (const [slug, bytes] of videos)
    if (videoPath(slug) === `/blog/media/${name}.mp4`) return bytes;
  return undefined;
}

/**
 * Copies a video into the site when it is built, as images are: the links of LinkedIn's videos
 * expire after a couple of weeks. A file over 50 MB, or one that can't be read, stays a link.
 */
async function copyVideo(slug: string, src: string): Promise<string> {
  if (!/^https?:\/\//.test(src)) return src;
  let bytes = videos.get(slug);
  if (!bytes) {
    bytes = fetch(src, { signal: AbortSignal.timeout(60_000) })
      .then(async (response) => {
        if (!response.ok) throw new Error(`the answer was ${response.status}`);
        if (Number(response.headers.get("content-length")) > 50_000_000)
          throw new Error("it is over 50 MB");
        return new Uint8Array(await response.arrayBuffer());
      })
      .catch((error) => {
        console.warn(
          `[blog] Couldn't copy the video of ${slug}: ${error.message}. The post links to it.`,
        );
        return undefined;
      });
    videos.set(slug, bytes);
  }
  return (await bytes) ? videoPath(slug) : src;
}

/** The first paragraph of a post in Markdown, as plain text: a short opening line is skipped. */
function firstParagraph(markdown: string): string | undefined {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block && !/^(#|```|!\[|<|>|- |\* |\d+\. )/.test(block));
  const paragraph = paragraphs.find((block) => block.length >= 60) ?? paragraphs[0];
  return paragraph
    ?.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ");
}

function videoFile(src: string): Embed["video"] {
  return { kind: "file", src };
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
