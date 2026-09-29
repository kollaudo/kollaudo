import type { TestRunSummary } from "@kollaudo/schema";

const ITEMS = [
  { key: "passed", label: "passed", className: "text-passed" },
  { key: "failed", label: "failed", className: "text-failed" },
  { key: "flaky", label: "flaky", className: "text-flaky" },
  { key: "skipped", label: "skipped", className: "text-muted" },
  { key: "pending", label: "pending", className: "text-muted" },
  { key: "other", label: "other", className: "text-muted" },
] as const;

/** Test counts of a run, leaving out the ones at zero. */
export function Counts({ summary }: { summary: TestRunSummary }) {
  if (summary.tests === 0) return <span className="text-muted">no tests</span>;
  return (
    <span className="flex flex-wrap gap-x-2">
      {ITEMS.filter(({ key }) => summary[key] > 0).map(({ key, label, className }) => (
        <span key={key} className={className}>
          {summary[key]} {label}
        </span>
      ))}
    </span>
  );
}
