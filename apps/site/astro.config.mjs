import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://kollaudo.dev",
  // The blog copies the images of posts from other sites into the build.
  image: { remotePatterns: [{ protocol: "https" }] },
  integrations: [
    starlight({
      title: "Kollaudo",
      description:
        "Quality gates for every promotion, whatever builds, tests and deploys your software.",
      logo: {
        light: "../../docs/assets/logo.svg",
        dark: "../../docs/assets/logo-dark.svg",
        alt: "",
      },
      favicon: "/favicon.svg",
      head: [
        {
          // Starlight restores the groups a reader closed, even when the page they open is inside
          // one. Open the groups around the current page, and bring it into view in the sidebar.
          tag: "script",
          content: `document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.getElementById("starlight__sidebar");
  const current = sidebar?.querySelector('a[aria-current="page"]');
  if (!current) return;
  for (let group = current.closest("details"); group; group = group.parentElement.closest("details")) {
    group.open = true;
  }
  const box = sidebar.getBoundingClientRect();
  const link = current.getBoundingClientRect();
  if (link.height && (link.top < box.top || link.bottom > box.bottom)) {
    sidebar.scrollTop += link.top - box.top - (box.height - link.height) / 2;
  }
});`,
        },
      ],
      customCss: ["./src/styles/theme.css"],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/kollaudo/kollaudo" }],
      editLink: { baseUrl: "https://github.com/kollaudo/kollaudo/edit/main/" },
      sidebar: [
        { label: "Start here", link: "/docs/" },
        {
          label: "Guides",
          items: [
            { slug: "docs/sending-results" },
            { slug: "docs/try-without-blocking" },
            { slug: "docs/policies" },
            { slug: "docs/overrides" },
            { slug: "docs/signoffs" },
            { slug: "docs/without-a-terminal" },
          ],
        },
        { label: "Recipes", items: [{ autogenerate: { directory: "docs/recipes" } }] },
        {
          label: "Decisions",
          collapsed: true,
          items: [{ autogenerate: { directory: "docs/adr" } }],
        },
        { label: "Project", items: [{ slug: "docs/releasing" }, { slug: "docs/milestones/v0.5" }] },
      ],
    }),
  ],
});
