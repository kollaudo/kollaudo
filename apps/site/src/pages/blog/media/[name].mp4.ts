// The videos of posts from other sites, copied when the site is built (see copyVideo in lib/posts.ts).
import type { APIRoute, GetStaticPaths } from "astro";
import { getPosts, videoBytes, videoPath } from "../../../lib/posts";

export const getStaticPaths = (async () => {
  const posts = await getPosts();
  return posts
    .filter((post) => post.video?.src === videoPath(post.slug))
    .map((post) => ({
      params: { name: videoPath(post.slug).slice("/blog/media/".length, -".mp4".length) },
    }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const bytes = await videoBytes(params.name ?? "");
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(bytes, { headers: { "content-type": "video/mp4" } });
};
