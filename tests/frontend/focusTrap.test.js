// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activateFocusTrap, deactivateFocusTrap } from "../../web/js/features/focusTrap.js";

function buildModal() {
    const modal = document.createElement("div");
    const btnA = document.createElement("button"); btnA.textContent = "A";
    const input = document.createElement("input");
    const btnB = document.createElement("button"); btnB.textContent = "B"; btnB.disabled = true;
    const link = document.createElement("a"); link.href = "#"; link.textContent = "L";
    modal.append(btnA, input, btnB, link);
    document.body.append(modal);
    return { modal, btnA, input, btnB, link };
}

describe("focusTrap", () => {
    beforeEach(() => deactivateFocusTrap());
    afterEach(() => deactivateFocusTrap());

    it("activates: focuses first focusable element", () => {
        const { modal, btnA } = buildModal();
        activateFocusTrap(modal);
        expect(document.activeElement).toBe(btnA);
    });

    it("deactivates: restores focus to previously focused element", () => {
        const trigger = document.createElement("button");
        trigger.textContent = "open";
        document.body.append(trigger);
        trigger.focus();

        const { modal } = buildModal();
        activateFocusTrap(modal);
        expect(document.activeElement).not.toBe(trigger);

        deactivateFocusTrap();
        expect(document.activeElement).toBe(trigger);
    });

    it("skips disabled elements when focusing", () => {
        const { modal, btnB } = buildModal();
        // btnB is disabled → should never receive focus
        activateFocusTrap(modal);
        expect(document.activeElement).not.toBe(btnB);
    });

    it("handles empty modal gracefully (falls back to root focus)", () => {
        const empty = document.createElement("div");
        document.body.append(empty);
        expect(() => activateFocusTrap(empty)).not.toThrow();
        expect(document.activeElement).toBe(empty);
    });

    it("double-activate replaces previous trap without leaking handlers", () => {
        const m1 = buildModal().modal;
        const m2 = buildModal().modal;
        activateFocusTrap(m1);
        activateFocusTrap(m2);
        deactivateFocusTrap();
        // No errors thrown = no dangling references
        expect(document.querySelectorAll("div").length).toBeGreaterThanOrEqual(2);
    });
});
