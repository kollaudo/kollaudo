// Loads the Announcements of the repository's GitHub Discussions into the blog when the site is built,
// so a release announced there shows up here without copying it. The REST API answers without a
// token; with GITHUB_TOKEN in the environment, the build gets GitHub's higher rate limit.
import type { Loader } from "astro/loaders";

const repository = "kollaudo/kollaudo";
const category = "announcements";

interface Discussion {
  number: number;
  title: string;
  body: string;
  html_url: string;
  created_at: string;
  user: { login: string } | null;
  category: { slug: string };
}

export function announcementsLoader(): Loader {
  return {
    name: "github-announcements",
    async load({ store, logger, parseData, renderMarkdown, generateDigest }) {
      let discussions: Discussion[];
      try {
        discussions = (await fetchDiscussions()).filter((d) => d.category.slug === category);
      } catch (error) {
        logger.warn(
          `Couldn't read the announcements of ${repository}: ${(error as Error).message}. The blog shows the posts it has.`,
        );
        return;
      }
      store.clear();
      for (const discussion of discussions) {
        const id = slugOf(discussion.title);
        const data = await parseData({
          id,
          data: {
            title: discussion.title,
            date: discussion.created_at,
            author: discussion.user?.login,
            url: discussion.html_url,
          },
        });
        const body = mentions(discussion.body.replace(/\r\n/g, "\n"));
        store.set({
          id,
          data,
          body,
          rendered: await renderMarkdown(body),
          digest: generateDigest(body + JSON.stringify(data)),
        });
      }
      logger.info(`${discussions.length} announcements from ${repository}.`);
    },
  };
}

async function fetchDiscussions(): Promise<Discussion[]> {
  const token = process.env.GITHUB_TOKEN;
  const all: Discussion[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/discussions?per_page=100&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "kollaudo-site",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const batch = (await response.json()) as Discussion[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/** "Kollaudo 0.4.0 is out: …" is /blog/kollaudo-0-4-0/; any other title is its own address. */
function slugOf(title: string): string {
  const release = title.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
  const text = release ? `kollaudo ${release}` : title;
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Links each @login to its GitHub profile, as GitHub does, outside code. */
function mentions(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(
            /(^|[^\w/@.[])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\b/g,
            "$1[@$2](https://github.com/$2)",
          ),
    )
    .join("");
}
