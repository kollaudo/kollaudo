import type { VerdictOutcome } from "@kollaudo/schema";

// The colors of results (docs/brand.md): unknown is amber, as evidence is missing rather than bad.
// An override is violet, the color of Kollaudo, since a person decided, not the evidence.
const COLOR: Record<VerdictOutcome | "override", string> = {
  pass: "text-passed",
  fail: "text-failed",
  unknown: "text-flaky",
  override: "text-brand",
};

export const BAR: Record<VerdictOutcome | "override", string> = {
  pass: "bg-passed/5 shadow-[inset_4px_0_0_var(--color-passed)]",
  fail: "bg-failed/5 shadow-[inset_4px_0_0_var(--color-failed)]",
  unknown: "bg-flaky/5 shadow-[inset_4px_0_0_var(--color-flaky)]",
  override: "bg-brand/5 shadow-[inset_4px_0_0_var(--color-brand)]",
};

/** What a verdict looks like: its outcome, or the override that let it through. */
export function look(outcome: VerdictOutcome, overridden: boolean) {
  return overridden ? "override" : outcome;
}

/** "PASS", "FAIL", "UNKNOWN" or "PASS (override)", as `kollaudo verdict` prints it. */
export function VerdictLabel({
  outcome,
  overridden,
  className = "",
}: {
  outcome: VerdictOutcome;
  overridden: boolean;
  className?: string;
}) {
  const label = outcome.toUpperCase() + (overridden ? " (override)" : "");
  return (
    <span className={`font-semibold ${COLOR[look(outcome, overridden)]} ${className}`}>
      {label}
    </span>
  );
}

/** The label of an outcome alone, as in the reasons and the log. */
export function OutcomeLabel({ outcome }: { outcome: VerdictOutcome }) {
  return <span className={`font-medium ${COLOR[outcome]}`}>{outcome}</span>;
}
