import { beforeEach, describe, expect, it } from "vitest";
import { formatFileSize, refineSearchQuery } from "../../web/js/util.js";
import { loadPresets, savePresets } from "../../web/js/features/promptLibrary.js";

// promptLibrary reads localStorage — provide a tiny in-memory stub before use.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

beforeEach(() => store.clear());

describe("formatFileSize", () => {
  it("formats bytes with one decimal", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
  });
});

describe("refineSearchQuery", () => {
  it("takes the first sentence and strips code fences", () => {
    const q = refineSearchQuery("Tìm giá vàng hôm nay. Và cả bạc? ```py\ncode()\n```");
    expect(q.startsWith("Tìm giá vàng hôm nay.")).toBe(true);
    expect(q).not.toContain("code()");
  });

  it("caps extremely long queries at 160 characters", () => {
    expect(refineSearchQuery("a".repeat(500)).length).toBeLessThanOrEqual(160);
  });
});

describe("promptLibrary persistence", () => {
  it("round-trips presets via localStorage stub", () => {
    expect(loadPresets()).toEqual([]);
    savePresets([{ name: "Coder", text: "You write code." }]);
    expect(loadPresets()).toEqual([{ name: "Coder", text: "You write code." }]);
  });

  it("falls back to [] when stored value is corrupt JSON", () => {
    localStorage.setItem("bobigo_prompt_presets", "{not json");
    expect(loadPresets()).toEqual([]);
  });
});
