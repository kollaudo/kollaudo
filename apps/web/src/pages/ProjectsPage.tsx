import type { HealthMatrix, Project } from "@kollaudo/schema";
import { type FormEvent, useState } from "react";
import { Message } from "../components/Message.tsx";
import { type ApiRequestError, apiGet } from "../lib/api.ts";
import {
  removeProject,
  type SavedProject,
  saveProject,
  selectProject,
  useProjects,
} from "../lib/projects.ts";
import { outcome } from "../lib/results.ts";
import { navigate } from "../lib/router.tsx";
import { useApi } from "../lib/useApi.ts";

export function ProjectsPage() {
  const { projects } = useProjects();

  return (
    <div className="mx-auto max-w-2xl">
      {projects.length === 0 ? (
        <Message title="Welcome to Kollaudo">
          Add a project with its <strong>read</strong> token to see the health of its versions.
          Create one with <code>kollaudo-server project create &lt;name&gt;</code>.
        </Message>
      ) : (
        <>
          <h1 className="mb-4 text-xl font-semibold">Projects</h1>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {projects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </ul>
        </>
      )}
      <AddProject />
    </div>
  );
}

function ProjectRow({ project }: { project: SavedProject }) {
  const { data, error } = useApi<HealthMatrix>("/v1/health", project.token);
  const failing = data?.latest.filter((run) => outcome(run.summary) === "failed").length ?? 0;

  let status = "Loading…";
  if (error) status = error.status === 401 ? "The token is no longer valid" : error.message;
  else if (data) {
    status =
      data.components.length === 0
        ? "No test runs yet"
        : `${plural(data.components.length, "component")}, ${failing} failing`;
  }

  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{project.name}</div>
        <div className={`text-sm ${error || failing > 0 ? "text-failed" : "text-muted"}`}>
          {status}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          selectProject(project.id);
          navigate("/");
        }}
        className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white dark:text-neutral-950"
      >
        Open
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm(`Remove ${project.name} from this browser?`)) removeProject(project.id);
        }}
        className="text-sm text-muted hover:text-failed"
      >
        Remove
      </button>
    </li>
  );
}

function AddProject() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const project = await apiGet<Project>("/v1/project", token.trim());
      saveProject({ ...project, token: token.trim() });
      navigate("/");
    } catch (error) {
      setError(explain(error as ApiRequestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8">
      <label htmlFor="token" className="block font-medium">
        Add a project
      </label>
      <p className="mt-1 text-sm text-muted">
        Paste a read token. Tokens are stored in this browser only.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          id="token"
          type="password"
          autoComplete="off"
          placeholder="kol_…"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 font-mono text-sm dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={busy || !token.trim()}
          className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:text-neutral-950"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-failed">{error}</p>}
    </form>
  );
}

function explain(error: ApiRequestError) {
  if (error.status === 401) return "Kollaudo doesn't know this token. It may have been revoked.";
  if (error.status === 403) {
    return "This token can't read. Paste a read token: ingest tokens can only send results.";
  }
  return error.message;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
