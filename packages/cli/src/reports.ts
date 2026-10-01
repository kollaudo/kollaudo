// Reads the files given to `kollaudo push` as one CTRF report: CTRF as it is, JUnit XML converted
// (ADR 0015). Several files, or glob patterns, make one run.

import type { CtrfReport } from "@kollaudo/schema";
import type { Io } from "./io.ts";
import { type JunitFile, junitToCtrf } from "./junit.ts";

export interface Loaded {
  report: unknown;
  format: "CTRF" | "JUnit";
  files: string[];
}

export class ReportError extends Error {}

const GLOB = /[*?[{]/;

export async function loadReport(
  patterns: string[],
  io: Pick<Io, "readFile" | "glob">,
  tool?: string,
): Promise<Loaded> {
  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = GLOB.test(pattern) ? await io.glob(pattern) : [pattern];
    if (matches.length === 0) throw new ReportError(`No file matches ${pattern}.`);
    for (const file of matches) if (!files.includes(file)) files.push(file);
  }

  const contents: { name: string; text: string; format: Loaded["format"] }[] = [];
  for (const name of files) {
    let text: string;
    try {
      text = await io.readFile(name);
    } catch (error) {
      throw new ReportError(`Can't read ${name}: ${(error as Error).message}`);
    }
    contents.push({ name, text, format: detect(name, text) });
  }

  const formats = new Set(contents.map((c) => c.format));
  if (formats.size > 1) {
    throw new ReportError("Send CTRF and JUnit files in separate pushes: they make separate runs.");
  }

  if (formats.has("JUnit")) {
    const junit: JunitFile[] = contents.map(({ name, text }) => ({ name, xml: text }));
    return { report: junitToCtrf(junit, tool ?? "junit"), format: "JUnit", files };
  }

  const reports = contents.map(({ name, text }) => {
    try {
      return { name, report: JSON.parse(text) as CtrfReport };
    } catch {
      throw new ReportError(`Can't read ${name}: it isn't valid JSON`);
    }
  });
  const report = reports.length === 1 ? reports[0]?.report : mergeCtrf(reports);
  if (tool && report?.results?.tool) report.results.tool.name = tool;
  return { report, format: "CTRF", files };
}

/** JSON is CTRF, XML is JUnit, whatever the file is called. */
function detect(name: string, text: string): Loaded["format"] {
  const first = text.replace(/^﻿/, "").trimStart()[0];
  if (first === "{") return "CTRF";
  if (first === "<") return "JUnit";
  throw new ReportError(`${name} is neither a CTRF report (JSON) nor a JUnit report (XML).`);
}

/** Several CTRF reports, such as the shards of a Playwright run, as one. */
function mergeCtrf(reports: { name: string; report: CtrfReport }[]): CtrfReport {
  for (const { name, report } of reports) {
    if (!Array.isArray(report?.results?.tests)) {
      throw new ReportError(`${name} isn't a CTRF report: it has no results.tests.`);
    }
  }
  const first = reports[0] as { report: CtrfReport };
  const tests = reports.flatMap(({ report }) => report.results.tests);
  const starts = reports.map(({ report }) => report.results.summary?.start).filter(isTime);
  const stops = reports.map(({ report }) => report.results.summary?.stop).filter(isTime);
  return {
    ...first.report,
    results: {
      ...first.report.results,
      summary: {
        tests: tests.length,
        ...(starts.length > 0 && { start: Math.min(...starts) }),
        ...(stops.length > 0 && { stop: Math.max(...stops) }),
      },
      tests,
    },
  };
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && value > 0;
}
