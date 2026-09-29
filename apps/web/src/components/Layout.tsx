import type { ReactNode } from "react";
import { selectProject, useProjects } from "../lib/projects.ts";
import { Link, navigate, useLocation } from "../lib/router.tsx";

export function Layout({ children }: { children: ReactNode }) {
  const { projects, current } = useProjects();
  const { path } = useLocation();

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold text-brand">
            <img src="/logo.svg" alt="" className="size-8 rounded-md" />
            Kollaudo
          </Link>

          {projects.length > 0 && (
            <select
              aria-label="Project"
              value={current?.id}
              onChange={(event) => {
                selectProject(event.target.value);
                if (path !== "/") navigate("/");
              }}
              className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          )}

          <nav className="ml-auto text-sm">
            <Link
              href="/projects"
              className={path === "/projects" ? "font-medium text-brand" : "hover:text-brand"}
            >
              Projects
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
