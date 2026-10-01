# Brand

## Logo

An ink stamp with a K, as on a passport, with no background:

| File | Ink | Use on |
|---|---|---|
| [`assets/logo.svg`](assets/logo.svg) | ink violet `#5B3E96` | light backgrounds. This is the source |
| [`assets/logo-dark.svg`](assets/logo-dark.svg) | light violet `#B49AE6` | dark backgrounds |
| [`assets/logo.png`](assets/logo.png) | ink violet `#5B3E96` | where SVG isn't accepted, such as avatars: 512 × 512, transparent |

On GitHub, pick the right SVG with `<picture>` and `prefers-color-scheme`. The web UI has its own
copy, [`apps/web/public/logo.svg`](../apps/web/public/logo.svg), that switches ink by itself with
the theme, for the header and the favicon.

## Title

[`assets/title.svg`](assets/title.svg) (and [`assets/title-dark.svg`](assets/title-dark.svg) for
dark themes) is the name as a stamped word: OLLAUDO appears letter by letter, then the stamp lands
in front of it as the K. The letters are drawn with strokes like the K of the stamp, not typed in a
font, so the title looks the same everywhere. It plays once, and people who reduce motion in their
system see it complete right away.

## Colors

Ink violet is Kollaudo. The other colors are verdicts, and are used only for results.
Keeping them apart means a green, red or amber mark on screen always says something about a test.

| Role | Light theme | Dark theme | Use |
|---|---|---|---|
| Brand | ink violet `#5B3E96` | `#B49AE6` | logo, links, primary buttons |
| Paper | `#F3EEE3` | | background of brand images, such as social previews |
| Passed | green `#1A7F37` | `#3FB950` | results only |
| Failed | red `#CF222E` | `#F85149` | results only |
| Flaky, warning | amber `#9A6700` | `#D29922` | results only |
| Skipped, pending, other | gray `#6E7781` | `#8B949E` | results only |

Surfaces in the UI are neutral grays. The UI follows the theme of the operating system, and defines
these colors in [`apps/web/src/index.css`](../apps/web/src/index.css).
