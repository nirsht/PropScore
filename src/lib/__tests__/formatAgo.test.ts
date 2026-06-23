import { describe, expect, it } from "vitest";
import { formatAgo } from "../formatAgo";

const NOW = new Date("2026-06-23T12:00:00Z");

describe("formatAgo", () => {
  it("returns null for null/undefined/invalid", () => {
    expect(formatAgo(null, NOW)).toBe(null);
    expect(formatAgo(undefined, NOW)).toBe(null);
    expect(formatAgo("not-a-date", NOW)).toBe(null);
  });

  it("treats future dates as just now (clock skew)", () => {
    const future = new Date(NOW.getTime() + 5_000);
    expect(formatAgo(future, NOW)).toBe("just now");
  });

  it("collapses < 45 sec into just now", () => {
    expect(formatAgo(new Date(NOW.getTime() - 30_000), NOW)).toBe("just now");
  });

  it("renders minutes between 45s and 60min", () => {
    expect(formatAgo(new Date(NOW.getTime() - 60_000), NOW)).toBe("1 min ago");
    expect(formatAgo(new Date(NOW.getTime() - 30 * 60_000), NOW)).toBe("30 min ago");
  });

  it("renders hours between 1h and 24h", () => {
    expect(formatAgo(new Date(NOW.getTime() - 60 * 60_000), NOW)).toBe("1 hour ago");
    expect(formatAgo(new Date(NOW.getTime() - 5 * 60 * 60_000), NOW)).toBe("5 hours ago");
  });

  it("renders days between 1d and 30d", () => {
    expect(formatAgo(new Date(NOW.getTime() - 24 * 3_600_000), NOW)).toBe("1 day ago");
    expect(formatAgo(new Date(NOW.getTime() - 7 * 24 * 3_600_000), NOW)).toBe("7 days ago");
  });

  it("falls back to absolute date past 30d (same year)", () => {
    // 60 days ago in the same year → "Apr 24"
    const sameYear = new Date(NOW.getTime() - 60 * 24 * 3_600_000);
    const out = formatAgo(sameYear, NOW)!;
    expect(out).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  it("includes year past 30d when year differs", () => {
    const prevYear = new Date("2024-12-25T12:00:00Z");
    const out = formatAgo(prevYear, NOW)!;
    expect(out).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  });

  it("accepts ISO string input", () => {
    const iso = new Date(NOW.getTime() - 60_000).toISOString();
    expect(formatAgo(iso, NOW)).toBe("1 min ago");
  });
});
