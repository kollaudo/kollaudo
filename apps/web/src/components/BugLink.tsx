/** The key of a bug in the tracker, as a link to it. */
export function BugLink({ bug }: { bug: { key: string; url: string } }) {
  return (
    <a
      href={bug.url}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-brand hover:underline"
    >
      {bug.key}
    </a>
  );
}
