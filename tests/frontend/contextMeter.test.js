// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { initContextMeter } from "../../web/js/features/contextMeter.js";

function makeMeter(budget) {
    const root = document.createElement("div");
    const fill = document.createElement("div");
    const text = document.createElement("span");
    document.body.append(root, fill, text);
    return {
        root, fill, text,
        meter: initContextMeter({
            root, fill, text,
            getBudget: () => budget,
        }),
    };
}

describe("initContextMeter", () => {
    it("paints heuristic usage with ok/warn/over states", () => {
        const { meter, root, fill } = makeMeter(1000);
        const r1 = meter.update([{ role: "user", content: "x".repeat(400) }]);
        expect(r1.state).toBe("ok");
        expect(root.classList.contains("ctx-ok")).toBe(true);
        expect(fill.style.width).toMatch(/%$/);

        const big = Array.from({ length: 20 }, () => ({
            role: "user", content: "y".repeat(200),
        }));
        const r2 = meter.update(big, "system prompt");
        expect(r2.used).toBeGreaterThan(r1.used);

        const r3 = meter.update(
            Array.from({ length: 60 }, () => ({ role: "user", content: "z".repeat(200) }))
        );
        expect(["warn", "over"]).toContain(r3.state);
    });

    it("applyExact repaints using the real tokenizer count and marks the title", () => {
        const { meter, root } = makeMeter(1000);
        meter.update([{ role: "user", content: "abc" }]);
        expect(root.title).not.toContain("exact");

        const r = meter.applyExact(500);
        expect(r.used).toBe(Math.round(500 * 1.08));
        expect(root.title).toContain("· exact");

        expect(meter.applyExact(-5)).toBeNull();
        expect(meter.applyExact("nan")).toBeNull();
    });

    it("clamps to 100% when over budget", () => {
        const { meter } = makeMeter(100);
        const r = meter.update([{ role: "user", content: "a".repeat(5000) }]);
        expect(r.pct).toBe(100);
        expect(r.state).toBe("over");
    });
});
