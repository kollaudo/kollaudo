import type { ReactNode } from "react";

/** A centered message for empty states and errors. */
export function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children && <div className="mt-2 text-neutral-600 dark:text-neutral-400">{children}</div>}
    </div>
  );
}
