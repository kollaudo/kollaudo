import type { Project } from "@kollaudo/schema";
import { useSyncExternalStore } from "react";

/** A project the user added to this browser, with the read token used to see it. */
export interface SavedProject extends Project {
  token: string;
}

interface State {
  projects: SavedProject[];
  currentId: string | undefined;
}

const PROJECTS_KEY = "kollaudo.projects";
const CURRENT_KEY = "kollaudo.currentProject";

const listeners = new Set<() => void>();
let state = load();

function load(): State {
  let projects: SavedProject[] = [];
  try {
    projects = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]");
  } catch {
    // A corrupted entry: start again rather than breaking the UI.
  }
  const saved = localStorage.getItem(CURRENT_KEY) ?? undefined;
  const currentId = projects.some((p) => p.id === saved) ? saved : projects[0]?.id;
  return { projects, currentId };
}

function update(next: State) {
  state = next;
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(next.projects));
  if (next.currentId) localStorage.setItem(CURRENT_KEY, next.currentId);
  else localStorage.removeItem(CURRENT_KEY);
  for (const listener of listeners) listener();
}

// Keep tabs in sync when another tab adds or removes a project.
window.addEventListener("storage", (event) => {
  if (event.key !== PROJECTS_KEY && event.key !== CURRENT_KEY) return;
  state = load();
  for (const listener of listeners) listener();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function saveProject(project: SavedProject) {
  const others = state.projects.filter((p) => p.id !== project.id);
  const projects = [...others, project].sort((a, b) => a.name.localeCompare(b.name));
  update({ projects, currentId: project.id });
}

export function removeProject(id: string) {
  const projects = state.projects.filter((p) => p.id !== id);
  const currentId = state.currentId === id ? projects[0]?.id : state.currentId;
  update({ projects, currentId });
}

export function selectProject(id: string) {
  if (state.projects.some((p) => p.id === id)) update({ ...state, currentId: id });
}

export function useProjects() {
  const { projects, currentId } = useSyncExternalStore(subscribe, () => state);
  return { projects, current: projects.find((p) => p.id === currentId) };
}
