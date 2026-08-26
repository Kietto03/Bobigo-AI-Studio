import { describe, expect, it } from "vitest";
import { conversationTokens, estimateTokens, messageTokens } from "../../web/js/tokens.js";

describe("estimateTokens", () => {
  it("returns 0 for empty/non-string input", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });

  it("grows monotonically with length (~4 chars per token)", () => {
    const short = estimateTokens("abcdefgh"); // ceil((8+3)/4)
    const long = estimateTokens("a".repeat(400));
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
    expect(estimateTokens("abcd")).toBe(Math.ceil(7 / 4));
  });
});

describe("messageTokens", () => {
  it("counts content plus reasoning when present", () => {
    const base = messageTokens({ content: "a".repeat(40) });
    const withReason = messageTokens({ content: "a".repeat(40), reasoning: "b".repeat(40) });
    expect(withReason).toBeGreaterThan(base);
  });

  it("handles non-string content gracefully", () => {
    expect(messageTokens({})).toBeGreaterThanOrEqual(0);
    expect(messageTokens({ content: null })).toBeGreaterThanOrEqual(0);
  });
});

describe("conversationTokens", () => {
  it("adds a system-prompt overhead constant on top of messages", () => {
    const msgs = [{ role: "user", content: "hello" }];
    const withoutSystem = conversationTokens(msgs);
    const withSystem = conversationTokens(msgs, "You are Bobigo.");
    expect(withSystem).toBeGreaterThan(withoutSystem);
    expect(conversationTokens([], "")).toBe(0);
  });

  it("tolerates missing message arrays", () => {
    expect(conversationTokens(undefined, undefined)).toBe(0);
  });
});
