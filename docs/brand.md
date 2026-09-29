# Brand

## Logo

[`assets/logo.svg`](assets/logo.svg) is the source: an ink stamp with a K, as on a passport.
[`assets/logo.png`](assets/logo.png) is a 512 × 512 export for avatars.

Keep the paper background: the logo must read on both light and dark themes.

## Colors

Ink violet is Kollaudo. The other colors are verdicts, and are used only for results.
Keeping them apart means a green, red or amber mark on screen always says something about a test.

| Role | Light theme | Dark theme | Use |
|---|---|---|---|
| Brand | ink violet `#5B3E96` | `#B49AE6` | logo, links, primary buttons |
| Paper | `#F3EEE3` | | background of the logo and brand images |
| Passed | green `#1A7F37` | `#3FB950` | results only |
| Failed | red `#CF222E` | `#F85149` | results only |
| Flaky, warning | amber `#9A6700` | `#D29922` | results only |
| Skipped, pending, other | gray `#6E7781` | `#8B949E` | results only |

Surfaces in the UI are neutral grays. The UI follows the theme of the operating system, and defines
these colors in [`apps/web/src/index.css`](../apps/web/src/index.css).
