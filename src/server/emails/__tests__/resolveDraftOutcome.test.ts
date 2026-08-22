import { describe, expect, it } from "vitest";
import { resolveDraftOutcome } from "../sync";

const base = {
  status: "DRAFT",
  sentAt: null as Date | null,
  draftStillExists: false,
  outboundSeen: false,
  inboundSeen: false,
};

describe("resolveDraftOutcome", () => {
  it("drops a draft deleted in Gmail with nothing ever sent", () => {
    expect(resolveDraftOutcome(base)).toBe("delete");
  });

  it("keeps a draft that's still sitting in Gmail", () => {
    expect(resolveDraftOutcome({ ...base, draftStillExists: true })).toBe("keep");
  });

  it("marks a vanished draft with an outbound message as sent", () => {
    expect(resolveDraftOutcome({ ...base, outboundSeen: true })).toBe("sent");
  });

  it("keeps an inbound-only thread rather than throwing it away", () => {
    expect(resolveDraftOutcome({ ...base, inboundSeen: true })).toBe("keep");
  });

  it("never touches a thread that already left the draft stage", () => {
    expect(resolveDraftOutcome({ ...base, status: "SENT" })).toBe("keep");
    expect(resolveDraftOutcome({ ...base, status: "FAILED" })).toBe("keep");
  });

  it("never drops a thread that was sent, even if the draft is gone", () => {
    expect(resolveDraftOutcome({ ...base, sentAt: new Date("2026-08-01") })).toBe(
      "keep",
    );
  });
});
