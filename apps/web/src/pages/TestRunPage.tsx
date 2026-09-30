import type { TestResult, TestRunDetail } from "@kollaudo/schema";
import { useEffect, useState } from "react";
import { Counts } from "../components/Counts.tsx";
import { Message } from "../components/Message.tsx";
import { type ApiRequestError, apiGet } from "../lib/api.ts";
import { duration, shortDigest, shortVersion, timeAgo } from "../lib/format.ts";
import { type SavedProject, selectProject, useProjects } from "../lib/projects.ts";
import { groupBySuite } from "../lib/results.ts";
import { Link } from "../lib/router.tsx";

type Filter = "all" | "failed" | "flaky" | "skipped";

const FILTERS: Record<Filter, (result: TestResult) => boolean> = {
  all: () => true,
  failed: (result) => result.status === "failed",
  flaky: (result) => result.flaky,
  skipped: (result) => result.status !== "passed" && result.status !== "failed",
};

export function TestRunPage({ id }: { id: string }) {
  const { run, error } = useTestRun(id);
  const [filter, setFilter] = useState<Filter>("all");

  if (error) {
    return (
      <Message title="Test run not found">
        None of the projects in this browser has this test run. Add its project with a read token on
        the{" "}
        <Link href="/projects" className="text-brand hover:underline">
          projects page
        </Link>
        .
      </Message>
    );
  }
  if (!run) return <Message title="Loading…" />;

  const results = run.results.filter(FILTERS[filter]);
  const took =
    run.startedAt && run.finishedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : undefined;

  return (
    <>
      <Link href="/" className="text-sm text-muted hover:text-brand">
        ← Health matrix
      </Link>
      <h1 className="mt-2 text-xl font-semibold">
        {run.component} <span className="font-mono">{shortVersion(run.version)}</span>
        {run.environment ? ` on ${run.environment}` : " (build)"}
      </h1>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        <Meta label="Kind" value={run.kind} />
        <Meta label="Tool" value={run.tool} />
        <Meta label="Received" value={timeAgo(run.createdAt)} />
        <Meta label="Took" value={took === undefined ? null : duration(took)} />
        <Meta
          label="Version"
          value={run.version === shortVersion(run.version) ? null : run.version}
        />
        <Meta label="Commit" value={run.commit && shortVersion(run.commit)} />
        <Meta label="Branch" value={run.branch} />
        <Meta label="Tag" value={run.tag} />
        <Meta label="Pull request" value={run.pullRequest} />
        <Meta label="Digest" value={run.digest && shortDigest(run.digest)} />
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <span className="font-medium">{run.summary.tests} tests</span>
        <Counts summary={run.summary} />
      </div>

      <fieldset className="mt-6 flex gap-1 text-sm">
        <legend className="sr-only">Show</legend>
        {(Object.keys(FILTERS) as Filter[]).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={filter === name}
            onClick={() => setFilter(name)}
            className="rounded-md px-3 py-1 capitalize aria-pressed:bg-brand aria-pressed:text-white dark:aria-pressed:text-neutral-950"
          >
            {name}
          </button>
        ))}
      </fieldset>

      {results.length === 0 ? (
        <p className="mt-6 text-muted">No tests to show.</p>
      ) : (
        groupBySuite(results).map((group) => (
          <section key={group.suite.join("\u0000")} className="mt-6">
            <h2 className="mb-2 text-sm font-medium text-muted">
              {group.suite.length > 0 ? group.suite.join(" › ") : "No suite"}
            </h2>
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {group.results.map((result) => (
                <ResultRow key={result.id} result={result} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-1">
      <dt>{label}</dt>
      <dd className="text-neutral-900 dark:text-neutral-100">{value}</dd>
    </div>
  );
}

const ICONS: Record<TestResult["status"], { icon: string; className: string }> = {
  passed: { icon: "✓", className: "text-passed" },
  failed: { icon: "✕", className: "text-failed" },
  skipped: { icon: "○", className: "text-muted" },
  pending: { icon: "…", className: "text-muted" },
  other: { icon: "?", className: "text-muted" },
};

function ResultRow({ result }: { result: TestResult }) {
  const { icon, className } = ICONS[result.status];
  const details = result.message || result.trace;

  const header = (
    <div className="flex items-baseline gap-3">
      <span className={`w-4 shrink-0 text-center font-bold ${className}`} title={result.status}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{result.name}</span>
        {result.file && <span className="ml-2 text-xs text-muted">{result.file}</span>}
      </span>
      {result.flaky && (
        <span className="rounded bg-flaky/10 px-1.5 text-xs font-medium text-flaky">flaky</span>
      )}
      {result.retries > 0 && (
        <span className="text-xs text-muted">
          {result.retries} {result.retries === 1 ? "retry" : "retries"}
        </span>
      )}
      <span className="w-20 shrink-0 text-right text-xs text-muted">
        {duration(result.durationMs)}
      </span>
    </div>
  );

  if (!details) return <li className="px-4 py-2 text-sm">{header}</li>;
  return (
    <li className="text-sm">
      <details open={result.status === "failed"}>
        <summary className="cursor-pointer list-none px-4 py-2">{header}</summary>
        <div className="px-4 pb-3 pl-11">
          {result.message && (
            <pre className="whitespace-pre-wrap break-words text-failed">{result.message}</pre>
          )}
          {result.trace && (
            <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
              {result.trace}
            </pre>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * Loads a run with the token of the current project, then with the others: a link from the CLI
 * doesn't say which project the run belongs to. Switches to the project that has it.
 */
function useTestRun(id: string) {
  const { projects, current } = useProjects();
  const [result, setResult] = useState<{ run?: TestRunDetail; error?: ApiRequestError }>({});

  // Look the run up again only when the run or the set of projects changes, not when this page
  // switches the current project.
  const tokens = projects.map((p) => p.token).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const controller = new AbortController();
    const candidates: SavedProject[] = [
      ...(current ? [current] : []),
      ...projects.filter((p) => p.id !== current?.id),
    ];
    setResult({});

    (async () => {
      let lastError: ApiRequestError | undefined;
      for (const project of candidates) {
        try {
          const run = await apiGet<TestRunDetail>(
            `/v1/test-runs/${encodeURIComponent(id)}`,
            project.token,
            controller.signal,
          );
          if (project.id !== current?.id) selectProject(project.id);
          setResult({ run });
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          lastError = error as ApiRequestError;
        }
      }
      setResult({ error: lastError ?? (new Error("No projects") as ApiRequestError) });
    })();

    return () => controller.abort();
  }, [id, tokens]);

  return result;
}
