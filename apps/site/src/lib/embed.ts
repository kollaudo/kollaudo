// Reads a post published somewhere else, so the blog can show it: its text, images and video.
// It runs when the site is built. Hacker News and Reddit have public JSON; any other page, such as
// LinkedIn, is read from its Open Graph tags, which carry the text (often cut short), an image and
// sometimes a video. The text is kept as plain paragraphs: no HTML from another site reaches ours.
//
// Reddit answers its JSON only to apps it knows. With REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (a
// "script" app from https://www.reddit.com/prefs/apps) in the environment of the build, the post is
// read through its API; without them, from the tags of its page, when Reddit serves it.

export interface Embed {
  source: string;
  url: string;
  title?: string;
  author?: string;
  date?: Date;
  paragraphs: string[];
  images: string[];
  video?: { kind: "file" | "frame"; src: string };
  /** The image a video shows before it plays. */
  poster?: string;
  /** The page a Hacker News or Reddit post links to, if it isn't a text post. */
  link?: string;
}

const agent = "Mozilla/5.0 (compatible; KollaudoSite/1.0; +https://kollaudo.dev)";
const cache = new Map<string, Promise<Embed | undefined>>();

/** Reads a post once per build. Returns undefined, with a warning, if the page can't be read. */
export function embed(url: string): Promise<Embed | undefined> {
  let post = cache.get(url);
  if (!post) {
    post = read(new URL(url)).catch((error) => {
      console.warn(
        `[blog] Couldn't read ${url}: ${error.message}. The post shows what its file says.`,
      );
      return undefined;
    });
    cache.set(url, post);
  }
  return post;
}

/** The name of the site a post comes from, for its label. */
export function sourceOf(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const names: Record<string, string> = {
    "linkedin.com": "LinkedIn",
    "news.ycombinator.com": "Hacker News",
    "reddit.com": "Reddit",
    "old.reddit.com": "Reddit",
    "youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "x.com": "X",
    "twitter.com": "X",
    "dev.to": "DEV",
    "medium.com": "Medium",
    "github.com": "GitHub",
  };
  return names[host] ?? host;
}

async function read(url: URL): Promise<Embed> {
  const host = url.hostname.replace(/^www\./, "");
  const special =
    host === "news.ycombinator.com"
      ? hackerNews
      : host === "reddit.com" || host.endsWith(".reddit.com")
        ? reddit
        : undefined;
  if (!special) return openGraph(url);
  try {
    return await special(url);
  } catch (error) {
    console.warn(`[blog] ${url.href}: ${(error as Error).message}. Trying the tags of the page.`);
    return openGraph(url);
  }
}

async function get(
  url: string,
  accept: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const response = await fetch(url, {
    headers: { "user-agent": agent, accept, ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`the answer was ${response.status}`);
  return response;
}

async function hackerNews(url: URL): Promise<Embed> {
  const id = url.searchParams.get("id");
  if (!id) throw new Error("the link has no item id");
  const item = await (
    await get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, "application/json")
  ).json();
  if (!item) throw new Error("there is no such item");
  return {
    source: "Hacker News",
    url: url.href,
    title: item.title,
    author: item.by,
    date: item.time ? new Date(item.time * 1000) : undefined,
    paragraphs: paragraphs(item.text ?? ""),
    images: [],
    link: item.url,
  };
}

async function reddit(url: URL): Promise<Embed> {
  const path = url.pathname.replace(/\/$/, "");
  const token = await redditToken();
  const listing = await (token
    ? await get(`https://oauth.reddit.com${path}?raw_json=1`, "application/json", {
        authorization: `Bearer ${token}`,
      })
    : await get(`https://www.reddit.com${path}.json?raw_json=1`, "application/json")
  ).json();
  const post = listing?.[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error("there is no post at this address");
  const images: string[] = [];
  if (post.media_metadata) {
    const order: string[] =
      post.gallery_data?.items?.map((item: { media_id: string }) => item.media_id) ?? [];
    for (const id of order.length ? order : Object.keys(post.media_metadata)) {
      const src = post.media_metadata[id]?.s?.u;
      if (src) images.push(src);
    }
  } else if (post.post_hint === "image" && post.url_overridden_by_dest) {
    images.push(post.url_overridden_by_dest);
  } else if (post.preview?.images?.[0]?.source?.url && !post.is_video) {
    images.push(post.preview.images[0].source.url);
  }
  const video = post.media?.reddit_video?.fallback_url;
  const external = post.url_overridden_by_dest;
  return {
    source: "Reddit",
    url: url.href,
    title: post.title,
    author: post.author ? `u/${post.author}` : undefined,
    date: post.created_utc ? new Date(post.created_utc * 1000) : undefined,
    paragraphs: paragraphs(post.selftext_html ?? ""),
    images,
    video: video ? { kind: "file", src: video } : undefined,
    link: external && !post.is_video && !images.includes(external) ? external : undefined,
  };
}

let redditTokenOnce: Promise<string | undefined> | undefined;

/** A token for Reddit's API, when the build has the credentials of an app. */
function redditToken(): Promise<string | undefined> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return Promise.resolve(undefined);
  redditTokenOnce ??= fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "user-agent": agent,
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  })
    .then((response) =>
      response.ok
        ? response.json()
        : Promise.reject(new Error(`the answer was ${response.status}`)),
    )
    .then((body) => body.access_token as string)
    .catch((error) => {
      console.warn(
        `[blog] Reddit didn't give a token: ${error.message}. Is REDDIT_CLIENT_SECRET right?`,
      );
      return undefined;
    });
  return redditTokenOnce;
}

async function openGraph(url: URL): Promise<Embed> {
  const html = await (await get(url.href, "text/html")).text();
  const meta = metaTags(html);
  const first = (...names: string[]) => names.map((name) => meta.get(name)?.[0]).find(Boolean);
  // Many pages, LinkedIn's among them, also describe the post as schema.org data, with its whole
  // text and its date, where the tags have only the first lines.
  const post = schemaPost(html, first("og:url") ?? url.href);
  const published = post?.date ?? first("article:published_time", "og:published_time", "date");
  const text = post?.text ?? first("og:description", "twitter:description", "description") ?? "";
  // A page that blocks robots still answers, with a title and nothing else.
  if (!first("og:title", "twitter:title") && !text) throw new Error("the page has no post to show");
  // A site we know by name keeps that name; any other is called what it calls itself.
  const host = url.hostname.replace(/^www\./, "");
  const known = sourceOf(url.href);
  const linkedIn = host === "linkedin.com" ? linkedInMedia(html, post?.type) : undefined;
  const images = linkedIn?.images.length
    ? linkedIn.images
    : post?.images.length
      ? post.images
      : [...(meta.get("og:image") ?? []), ...(meta.get("twitter:image") ?? [])];
  return {
    source: known !== host ? known : (first("og:site_name") ?? host),
    url: url.href,
    title: post?.title ?? first("og:title", "twitter:title"),
    author: post?.author ?? first("article:author", "author"),
    date: published && !Number.isNaN(Date.parse(published)) ? new Date(published) : undefined,
    paragraphs: text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean),
    images: [...new Set(images)].filter((src) => !placeholder(src)).slice(0, 4),
    video:
      linkedIn?.video ??
      videoOf(url, post?.video ?? first("og:video:secure_url", "og:video:url", "og:video")),
    poster: linkedIn?.poster,
  };
}

/** Images a site shows when a post has none of its own, such as LinkedIn's gray video frame. */
function placeholder(src: string): boolean {
  return /^https:\/\/static\.licdn\.com\//.test(src);
}

interface SchemaPost {
  type: string;
  title?: string;
  text?: string;
  date?: string;
  author?: string;
  images: string[];
  video?: string;
}

/** The post a page describes in schema.org JSON-LD: the one with the page's address, or the first. */
function schemaPost(html: string, address: string): SchemaPost | undefined {
  const types =
    /^(SocialMediaPosting|DiscussionForumPosting|VideoObject|Article|NewsArticle|BlogPosting)$/;
  const found: Record<string, unknown>[] = [];
  for (const [, json] of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(json);
      const items = [data, ...(Array.isArray(data?.["@graph"]) ? data["@graph"] : [])].flat();
      for (const item of items) if (types.test(String(item?.["@type"]))) found.push(item);
    } catch {}
  }
  const item =
    found.find((candidate) => candidate["@id"] === address || candidate.url === address) ??
    found[0];
  if (!item) return undefined;
  const string = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : undefined;
  const name = (value: unknown): string | undefined =>
    string(value) ??
    (value && typeof value === "object" ? string((value as { name?: unknown }).name) : undefined);
  const urls = (value: unknown): string[] =>
    [value]
      .flat()
      .map(
        (image) =>
          string(image) ??
          (image && typeof image === "object"
            ? string((image as { url?: unknown }).url)
            : undefined),
      )
      .filter((src): src is string => Boolean(src));
  return {
    type: String(item["@type"]),
    title: string(item.headline) ?? string(item.name),
    text: string(item.articleBody) ?? string(item.text) ?? string(item.description),
    date: string(item.datePublished) ?? string(item.uploadDate),
    author: name([item.author].flat()[0]) ?? name(item.creator),
    images: [...urls(item.image), ...urls(item.thumbnailUrl)],
    video: string(item.contentUrl),
  };
}

/**
 * The video or the image of a LinkedIn post. The page also shows media of other posts, suggested
 * next to it, so a video is taken only when the post is one (its schema.org type says so), and an
 * image is the first one in the body of the page, where the post comes before the others. The
 * links expire after a few weeks: the blog copies the files when it builds.
 */
function linkedInMedia(
  html: string,
  type?: string,
): { video?: Embed["video"]; poster?: string; images: string[] } {
  const page = html.replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
  if (type !== "VideoObject") {
    const body = page.slice(Math.max(0, page.indexOf("<body")));
    const image = body.match(
      /https:\/\/media\.licdn\.com\/dms\/image\/v2\/([\w-]+)\/feedshare-/,
    )?.[1];
    const largest = [
      "feedshare-image-high-res",
      "feedshare-shrink_2048",
      "feedshare-shrink_1280",
      "feedshare-shrink_800",
    ]
      .map(
        (size) =>
          page.match(
            new RegExp(`https://media\\.licdn\\.com/dms/image/v2/${image}/${size}/[^"'\\s<]*`),
          )?.[0],
      )
      .find(Boolean);
    return { images: image && largest ? [largest] : [] };
  }
  const id = page.match(
    /https:\/\/dms\.licdn\.com\/playlist\/vid\/(?:v2|dynamic)\/([\w-]+)\//,
  )?.[1];
  if (!id) return { images: [] };
  const file = (kind: string) =>
    page.match(
      new RegExp(`https://dms\\.licdn\\.com/playlist/vid/v2/${id}/${kind}[^"'\\\\\\s<]*`),
    )?.[0];
  const mp4 = file("mp4-720p") ?? file("mp4-640p") ?? file("mp4-");
  return {
    video: mp4 ? { kind: "file", src: mp4 } : undefined,
    poster: file("thumbnail-shrink_720_1280"),
    images: [],
  };
}

/** A video plays from a file, or in a frame only from a player we know. */
function videoOf(page: URL, og?: string): Embed["video"] {
  const host = page.hostname.replace(/^www\./, "");
  const youtube =
    host === "youtu.be"
      ? page.pathname.slice(1)
      : host.endsWith("youtube.com")
        ? page.searchParams.get("v")
        : null;
  if (youtube)
    return {
      kind: "frame",
      src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtube)}`,
    };
  const vimeo = host === "vimeo.com" ? page.pathname.match(/^\/(\d+)/)?.[1] : null;
  if (vimeo) return { kind: "frame", src: `https://player.vimeo.com/video/${vimeo}` };
  if (og && /^https:\/\/[^?#]+\.(mp4|webm)(\?|#|$)/i.test(og)) return { kind: "file", src: og };
  return undefined;
}

/** The meta tags of a page, by property or name, in the order they appear. */
function metaTags(html: string): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attribute = (name: string) =>
      tag
        .match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))
        ?.slice(2)
        .find((v) => v !== undefined);
    const key = (attribute("property") ?? attribute("name"))?.toLowerCase();
    const content = attribute("content");
    if (!key || content === undefined) continue;
    tags.set(key, [...(tags.get(key) ?? []), decode(content)]);
  }
  return tags;
}

/** Turns the HTML of a post into plain paragraphs. */
export function paragraphs(html: string): string[] {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>|<p\b[^>]*>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "");
  return decode(text)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

function decode(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const point =
        code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}
