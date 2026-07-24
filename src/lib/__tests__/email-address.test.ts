import { describe, expect, it } from "vitest";
import { isValidEmailAddress } from "../email-address";

describe("isValidEmailAddress", () => {
  it("accepts ordinary single addresses", () => {
    expect(isValidEmailAddress("agent@example.com")).toBe(true);
    expect(isValidEmailAddress("first.last+tag@sub.example.co.uk")).toBe(true);
    expect(isValidEmailAddress("  agent@example.com  ")).toBe(true);
  });

  it("rejects empty / missing values", () => {
    expect(isValidEmailAddress(null)).toBe(false);
    expect(isValidEmailAddress(undefined)).toBe(false);
    expect(isValidEmailAddress("")).toBe(false);
    expect(isValidEmailAddress("   ")).toBe(false);
  });

  it("rejects the malformed values contact enrichment actually stores", () => {
    // Agent name instead of an email (whitespace, no @) — the dominant case.
    expect(isValidEmailAddress("Jane Agent")).toBe(false);
    // Placeholder words.
    expect(isValidEmailAddress("null")).toBe(false);
    expect(isValidEmailAddress("N/A")).toBe(false);
    // No dotted domain.
    expect(isValidEmailAddress("agent@localhost")).toBe(false);
  });

  it("rejects multi-recipient and display-name forms (single addr-spec only)", () => {
    expect(isValidEmailAddress("a@x.com, b@y.com")).toBe(false);
    expect(isValidEmailAddress("a@x.com; b@y.com")).toBe(false);
    expect(isValidEmailAddress("Jane <jane@x.com>")).toBe(false);
  });

  it("rejects header-injection attempts", () => {
    expect(isValidEmailAddress("a@x.com\r\nBcc: evil@x.com")).toBe(false);
    expect(isValidEmailAddress("a@x.com\nSubject: hijack")).toBe(false);
  });
});
