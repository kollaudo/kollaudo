import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";
import { announcementsLoader } from "./lib/announcements";

// A post of the blog is a Markdown file in src/content/blog/, named as its address: hello.md is
// /blog/hello/. It is written here, or it shows a post published somewhere else:
//
//   ---
//   link: https://news.ycombinator.com/item?id=...
//   ---
//
// With a link, the build reads the post's title, text, images, video, author and date (see
// src/lib/embed.ts). Anything written in the file wins over what it reads, so a post the build can't
// read, such as one LinkedIn hides from robots, still shows what the file says. The body of a linked
// post is a note shown above it.
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        /** The text of a post from another site, in paragraphs, kept here in case it can't be read. */
        text: z.string().optional(),
        date: z.coerce.date().optional(),
        author: z.string().optional(),
        link: z.string().url().optional(),
        // A link, or a file next to the post, such as ./images/card.jpg, which never expires.
        image: z.union([z.string().url(), image()]).optional(),
        video: z.string().url().optional(),
        // The image a video shows before it plays, when its first frame says nothing.
        poster: z.union([z.string().url(), image()]).optional(),
        draft: z.boolean().default(false),
      })
      .refine((post) => post.link || (post.title && post.date), {
        message: "A post needs a title and a date, unless it has a link to read them from.",
      }),
});

// The Announcements of GitHub Discussions are posts of the blog too (see src/lib/announcements.ts).
const announcements = defineCollection({
  loader: announcementsLoader(),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    author: z.string().optional(),
    url: z.string().url(),
  }),
});

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  blog,
  announcements,
};
