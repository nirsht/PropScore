/**
 * Render a Date as a human-readable "X ago" relative to `now` (default
 * `new Date()`). Past 30 days, falls back to an absolute date like
 * "Mar 12" / "Mar 12, 2025" depending on year.
 *
 * Returns null for null/undefined/invalid input so callers can render
 * nothing when a timestamp is missing.
 */
export function formatAgo(
  date: Date | string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (date == null) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;

  const diffMs = now.getTime() - d.getTime();

  // Future dates: clamp to "just now". Clock skew between server and
  // browser shouldn't surface a confusing "in 3 seconds".
  if (diffMs < 0) return "just now";

  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;

  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;

  // Older than 30 days — render as absolute date. Include the year when
  // it doesn't match `now` so "Mar 12, 2023" is unambiguous.
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}
