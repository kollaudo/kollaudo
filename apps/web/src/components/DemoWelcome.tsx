import { type ReactNode, useState } from "react";
import { DEMO_READ_TOKEN } from "../lib/demo.ts";

/** Shown on the public demo to someone with no project yet: what to do and the token to use. */
export function DemoWelcome() {
  const [sent, setSent] = useState(false);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Welcome to the Kollaudo demo</h1>
      <p className="mt-1 text-neutral-600 dark:text-neutral-400">
        A made-up shop that sends its test results to Kollaudo. Three steps and you are looking at
        the data.
      </p>
      <ol className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card step={1} title="Create a project" wide>
          <CreateProject sent={sent} onSend={() => setSent(true)} />
        </Card>
        <Card step={2} title="Add it here" waiting={!sent}>
          <p>Paste the token in the form below and press Add.</p>
        </Card>
        <Card step={3} title="Look around" waiting={!sent}>
          <ul className="list-disc space-y-1 pl-4">
            <li>a version that fails</li>
            <li>one that waits for missing tests</li>
            <li>one that goes through an override</li>
            <li>one that reached production around the gate</li>
          </ul>
        </Card>
      </ol>
      <p className="mt-6 text-sm text-muted">
        The token only reads, and it is stored in this browser only. To use your own data, see the{" "}
        <a href="https://kollaudo.dev" className="underline">
          quick start
        </a>
        .
      </p>
    </div>
  );
}

function Card({
  step,
  title,
  wide,
  waiting,
  children,
}: {
  step: number;
  title: string;
  wide?: boolean;
  waiting?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={`flex flex-col rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800 ${
        wide ? "sm:col-span-2" : ""
      } ${waiting ? "opacity-50" : ""}`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted">Step {step}</div>
      <h2 className="mt-1 mb-3 font-semibold">{title}</h2>
      {children}
    </li>
  );
}

/** A terminal that doesn't run anything: Send shows the output of the command, with the demo token. */
function CreateProject({ sent, onSend }: { sent: boolean; onSend: () => void }) {
  const [copied, setCopied] = useState<"yes" | "no">();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(DEMO_READ_TOKEN);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  };

  return (
    <>
      <p className="mb-3">
        On your own server this command creates a project and prints its tokens. Here it only shows
        you the read token of the demo.
      </p>
      <div className="rounded-md bg-neutral-100 p-3 font-mono text-xs dark:bg-neutral-900">
        <div className="flex items-center gap-3">
          <code className="min-w-0 flex-1 break-all">
            <span className="select-none text-muted">$ </span>kollaudo-server project create demo
          </code>
          {!sent && (
            <button
              type="button"
              onClick={onSend}
              className="rounded-md bg-brand px-3 py-1 font-sans text-sm font-medium text-white dark:text-neutral-950"
            >
              Send
            </button>
          )}
        </div>
        <div aria-live="polite">
          {sent && (
            <pre className="mt-3 whitespace-pre-wrap break-all">
              {`Created project "demo".\n\nread     ${DEMO_READ_TOKEN}`}
            </pre>
          )}
        </div>
      </div>
      {sent && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-neutral-300 px-3 py-1 font-medium dark:border-neutral-700"
          >
            {copied === "yes" ? "Copied" : "Copy the token"}
          </button>
          <span className="text-muted">The demo shows the read token only.</span>
        </div>
      )}
      {copied === "no" && <p className="mt-2 text-failed">Select the token and copy it.</p>}
    </>
  );
}
