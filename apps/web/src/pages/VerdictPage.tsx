import type { GivenVerdictList, Verdict } from "@kollaudo/schema";
import { Message } from "../components/Message.tsx";
import { BAR, look, OutcomeLabel, VerdictLabel } from "../components/VerdictLabel.tsx";
import { shortVersion, timeAgo } from "../lib/format.ts";
import { useProjects } from "../lib/projects.ts";
import { Link } from "../lib/router.tsx";
import { useApi } from "../lib/useApi.ts";

/** How many verdicts given to gates the page lists. */
const LOG_LIMIT = 20;

/**
 * The verdict of a version in an environment, as a gate gets it, with its reasons: what the gate
 * sees, people see too.
 */
export function VerdictPage({ query }: { query: URLSearchParams }) {
  const { current } = useProjects();
  const target = new URLSearchParams({
    component: query.get("component") ?? "",
    environment: query.get("environment") ?? "",
    version: query.get("version") ?? "",
  });
  const complete = [...target.values()].every(Boolean);
  // record=false: reading the verdict here isn't a gate asking (ADR 0019).
  const { data: verdict, error } = useApi<Verdict>(
    complete ? `/v1/verdict?${target}&record=false` : undefined,
    current?.token,
  );
  const { data: log } = useApi<GivenVerdictList>(
    complete ? `/v1/verdicts?${target}&limit=${LOG_LIMIT}` : undefined,
    current?.token,
  );

  if (!current) {
    return (
      <Message title="No project">
        Add a project with a read token on the{" "}
        <Link href="/projects" className="text-brand hover:underline">
          projects page
        </Link>
        .
      </Message>
    );
  }
  if (!complete)
    return <Message title="Which verdict?">Choose a cell of the health matrix.</Message>;
  if (error) return <Message title="Can't load the verdict">{error.message}</Message>;
  if (!verdict) return <Message title="Loading…" />;

  const { policy, deployed, override } = verdict;
  const rules = [
    policy.name === "project" ? `policy revision ${policy.revision}` : "default rules",
    policy.require.length > 0 ? `requires ${policy.require.join(", ")}` : null,
    policy.deployed ? "tests of the deployed version only" : null,
    policy.flaky === "fail" ? "flaky tests fail" : null,
    policy.maxAge ? `runs from the last ${policy.maxAge}` : null,
  ].filter(Boolean);

  return (
    <>
      <Link href="/" className="text-sm text-muted hover:text-brand">
        ← Health matrix
      </Link>
      <div
        className={`mt-3 rounded-md py-3 pr-4 pl-5 ${BAR[look(verdict.outcome, override !== null)]}`}
      >
        <h1 className="text-xl font-semibold">
          <VerdictLabel outcome={verdict.outcome} overridden={override !== null} className="mr-1" />{" "}
          {verdict.component} <span className="font-mono">{shortVersion(verdict.version)}</span> in{" "}
          {verdict.environment}
        </h1>
        <p className="mt-1 text-neutral-700 dark:text-neutral-300">{verdict.message}</p>
      </div>

      <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Rules</dt>
        <dd>{rules.join(" · ")}</dd>
        {deployed && (
          <>
            <dt className="text-muted">Runs here</dt>
            <dd>
              <span className="font-mono">{shortVersion(deployed.version)}</span>, deployed{" "}
              {timeAgo(deployed.deployedAt)}
              {deployed.version !== verdict.version && (
                <span className="text-flaky"> · not the version judged</span>
              )}
              {deployed.gate && !deployed.gate.gated && (
                <span className="text-flaky">
                  {" "}
                  · ungated: no pass in {deployed.gate.from} before it was deployed
                </span>
              )}
            </dd>
          </>
        )}
      </dl>

      {override && (
        <section className="mt-6 rounded-md border border-brand/40 p-4 text-sm">
          <h2 className="font-semibold text-brand">Overridden</h2>
          <p className="mt-1">
            By {override.by ?? "a deleted token"}, until{" "}
            {new Date(override.expiresAt).toLocaleString()}: {override.reason}
          </p>
          <p className="mt-1 text-muted">
            The evidence alone is <OutcomeLabel outcome={verdict.evidenceOutcome} />.
          </p>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Why</h2>
        {verdict.reasons.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No test run of this version here.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-200 rounded-md border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {verdict.reasons.map((reason) => (
              <li key={reason.kind} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-3">
                <span className="w-16">
                  <OutcomeLabel outcome={reason.outcome} />
                </span>
                <span className="w-20 font-medium">{reason.kind}</span>
                <span className="flex-1">{reason.message}</span>
                {reason.run?.sentBy && <span className="text-muted">by {reason.run.sentBy}</span>}
                {reason.run && (
                  <Link href={`/test-runs/${reason.run.id}`} className="text-brand hover:underline">
                    Test run
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Asked by gates</h2>
        {!log || log.items.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No gate has asked about this version here yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {log.items.map((given) => (
              <li key={given.id} className="flex flex-wrap gap-x-3">
                <span
                  className="w-28 text-muted"
                  title={new Date(given.createdAt).toLocaleString()}
                >
                  {timeAgo(given.createdAt)}
                </span>
                <VerdictLabel
                  outcome={given.outcome}
                  overridden={given.overrideId !== null}
                  className="w-36"
                />
                <span className="text-muted">
                  asked by {given.askedBy ?? "a deleted token"}
                  {given.policyRevision !== null && `, policy revision ${given.policyRevision}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
