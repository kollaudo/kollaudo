import type { HealthMatrix, TestRun } from "@kollaudo/schema";
import { Counts } from "../components/Counts.tsx";
import { Message } from "../components/Message.tsx";
import { shortVersion, timeAgo } from "../lib/format.ts";
import { useProjects } from "../lib/projects.ts";
import { type Outcome, outcome, sortEnvironments } from "../lib/results.ts";
import { Link } from "../lib/router.tsx";
import { useApi } from "../lib/useApi.ts";
import { ProjectsPage } from "./ProjectsPage.tsx";

/** How often the matrix reloads, to show new runs without a manual refresh. */
const REFRESH_MS = 30_000;

/** Column of the runs without an environment: unit tests, static analysis… */
const BUILD = "";

export function HealthPage() {
  const { current } = useProjects();
  const { data, error } = useApi<HealthMatrix>("/v1/health", current?.token, REFRESH_MS);

  if (!current) return <ProjectsPage />;
  if (error && !data) {
    return (
      <Message title={`Can't load ${current.name}`}>
        {error.status === 401
          ? "The read token of this project is no longer valid. Remove the project and add it again with a new token."
          : error.message}
      </Message>
    );
  }
  if (!data) return <Message title="Loading…" />;
  if (data.components.length === 0) return <NoRuns project={current.name} />;

  const columns = [
    ...(data.latest.some((run) => run.environment === null) ? [BUILD] : []),
    ...sortEnvironments(data.environments),
  ];
  const cell = (component: string, column: string) =>
    data.latest.filter(
      (run) => run.component === component && (run.environment ?? BUILD) === column,
    );

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">{current.name}</h1>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-2 text-sm">
          <thead>
            <tr>
              <th className="w-40" />
              {columns.map((column) => (
                <th key={column} className="px-2 text-left font-medium text-muted">
                  {column === BUILD ? "Build" : column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.components.map((component) => (
              <tr key={component}>
                <th className="px-2 text-left align-top font-medium">{component}</th>
                {columns.map((column) => (
                  <td key={column} className="min-w-48 align-top">
                    <div className="flex flex-col gap-2">
                      {cell(component, column).map((run) => (
                        <RunCard key={run.id} run={run} />
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// The status bar is an inset shadow, so border colors (dark theme, hover) don't hide it.
const CARD: Record<Outcome, string> = {
  failed: "bg-failed/5 shadow-[inset_4px_0_0_var(--color-failed)]",
  passed: "bg-passed/5 shadow-[inset_4px_0_0_var(--color-passed)]",
  empty: "shadow-[inset_4px_0_0_var(--color-muted)]",
};

function RunCard({ run }: { run: TestRun }) {
  return (
    <Link
      href={`/test-runs/${run.id}`}
      className={`block rounded-md border border-neutral-200 py-2 pr-3 pl-4 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600 ${CARD[outcome(run.summary)]}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono font-medium" title={run.version}>
          {shortVersion(run.version)}
        </span>
        <span className="text-xs text-muted">{run.kind}</span>
      </div>
      <div className="mt-1 text-xs">
        <Counts summary={run.summary} />
      </div>
      <div className="mt-1 text-xs text-muted" title={new Date(run.createdAt).toLocaleString()}>
        {timeAgo(run.createdAt)}
      </div>
    </Link>
  );
}

function NoRuns({ project }: { project: string }) {
  return (
    <Message title={`No test runs in ${project} yet`}>
      <p>Send a CTRF report with an ingest token of this project:</p>
      <pre className="mt-4 overflow-x-auto rounded-md bg-neutral-100 p-3 text-left text-xs dark:bg-neutral-900">
        {`export KOLLAUDO_URL=${location.origin}
export KOLLAUDO_TOKEN=<ingest token>
npx @kollaudo/cli push ctrf-report.json \\
  --component frontend --env staging --version 1.2.0`}
      </pre>
    </Message>
  );
}
