/**
 * Accessibility: trap Tab focus inside a modal/dialog while it is open.
 * Pure DOM utility — no app state. Call `activate(el)` when a modal opens and
 * `deactivate()` when it closes; Escape handling stays with the caller.
 */

let activeTrap = null;
let _previousFocus = null;

function _focusableElements(root) {
    const sel = [
        "a[href]", "button:not([disabled])", "input:not([disabled])",
        "select:not([disabled])", "textarea:not([disabled])",
        '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    return Array.from(root.querySelectorAll(sel)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
    );
}

function _onKeydown(e) {
    if (!activeTrap) return;
    if (e.key === "Tab") {
        const items = _focusableElements(activeTrap);
        if (!items.length) {
            e.preventDefault();
            return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
}

/** Start trapping focus inside `root`. Returns the previously focused element. */
export function activateFocusTrap(root) {
    if (!root) return null;
    deactivateFocusTrap();
    activeTrap = root;
    _previousFocus = document.activeElement;
    const items = _focusableElements(root);
    (items[0] || root).focus();
    document.addEventListener("keydown", _onKeydown, true);
    return _previousFocus;
}

/** Release the trap and restore focus to whoever had it before activation. */
export function deactivateFocusTrap() {
    if (!activeTrap) return;
    document.removeEventListener("keydown", _onKeydown, true);
    if (_previousFocus && typeof _previousFocus.focus === "function") {
        try { _previousFocus.focus(); } catch (e) { /* element may be gone */ }
    }
    activeTrap = null;
    _previousFocus = null;
}
