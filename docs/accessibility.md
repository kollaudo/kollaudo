# Accessibility

Kollaudo is used in the middle of a release: someone waits for a verdict and has to read it fast
and without doubt. That is not possible if the verdict can only be read by some people. This page
says what we aim for and what the interface does today.

## Goal

The web UI (`apps/web`) and the website (`apps/site`) aim to meet
[WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA. We have **not** had an accessibility audit
yet and we do not claim conformance. Where this page says something works, it is because it is in
the code.

## What the web UI does today

- **Colour is never the only signal.** Counts and verdicts carry a text label (`passed`, `failed`
  and the verdict itself) next to the colour, so they can be read without telling red from green.
- **Light and dark.** The UI follows the colour scheme of the operating system
  (`prefers-color-scheme`).
- **Labelled controls.** The token field has a visible `<label>`. The project selector has an
  accessible name. Filters on the test run page expose their state with `aria-pressed`.
- **Decorative images are hidden** from assistive technology (empty `alt`, `aria-hidden`).
- **Page language.** The pages declare `lang="en"`.

## Known gaps

We have not checked these yet. They are the first things to look at:

- full keyboard navigation of every page and a visible focus indicator on every control;
- colour contrast of every text and background pair in both colour schemes;
- behavior with a screen reader, and with the browser zoomed to 200%;
- `prefers-reduced-motion`, if the UI has animations;
- the website, which Starlight provides with its own defaults and which we have not tested.

## CLI

`kollaudo verdict` prints plain text, and `--json` gives the same answer for tools. The exit code
carries the result, so a gate does not depend on reading colours or symbols.

## Reporting a problem

If something in Kollaudo is hard or impossible to use for you, please
[open an issue](https://github.com/kollaudo/kollaudo/issues) and say:

- the page or command;
- what you were trying to do and what stopped you;
- the browser and the assistive technology you use, if any.

You do not need to know the WCAG criterion. A fix for an accessibility problem is treated like any
other bug, and a pull request that fixes one is welcome. Please also read our
[Code of Conduct](../CODE_OF_CONDUCT.md).
