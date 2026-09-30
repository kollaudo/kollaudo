const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 minutes ago", "yesterday"… */
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** "850 ms", "12.3 s", "4 min 05 s". */
export function duration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

/** Full git SHAs are shortened, like git does. Other versions are shown as they are. */
export function shortVersion(version: string) {
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(version) ? version.slice(0, 7) : version;
}

/** "sha256:4f5c2d7e8a1b…" keeps the algorithm and 12 hex digits, like container tools do. */
export function shortDigest(digest: string) {
  const match = /^([a-z0-9]+):([0-9a-f]{12})[0-9a-f]{20,}$/.exec(digest);
  return match ? `${match[1]}:${match[2]}` : digest;
}
