/**
 * BobigoDB — persistence facade for the heavy app data (chat sessions,
 * companions, projects).
 *
 * System of record is now **PostgreSQL on the server** (see backend/db). This
 * module keeps the same tiny synchronous-friendly interface the rest of the app
 * already uses (`ready` / `getSync` / `set` / `flushNow`) so nothing else had to
 * change:
 *
 *   - `ready`  : GET each collection from the server into an in-memory mirror.
 *                On first run, any legacy browser data (IndexedDB / older
 *                localStorage) is imported to the server exactly once.
 *   - `getSync`: synchronous read from the mirror.
 *   - `set`    : update the mirror now; debounced PUT to the server, and a
 *                write-through to a local IndexedDB cache.
 *
 * IndexedDB is retained purely as an **offline cache / fallback**: if the server
 * (Postgres) is unreachable, the app keeps working against the local cache and
 * simply doesn't sync until the server returns.
 */
(function (global) {
    const DB_NAME = "bobigo";
    const DB_VERSION = 1;
    const STORE = "kv";
    const FLUSH_DELAY = 300;

    // Owned collections -> their REST endpoints.
    const ENDPOINT = {
        bobigo_sessions: "/api/sessions",
        bobigo_companions: "/api/companions",
        bobigo_projects: "/api/projects",
    };
    const KEYS = Object.keys(ENDPOINT);

    let _db = null;              // IndexedDB handle (offline cache); may stay null
    let serverMode = false;      // true when the Postgres backend is reachable
    const cache = Object.create(null);
    const writeQueue = Object.create(null);
    let flushTimer = null;

    // ----- IndexedDB (local offline cache) ---------------------------------
    function openDB() {
        return new Promise((resolve, reject) => {
            let req;
            try { req = indexedDB.open(DB_NAME, DB_VERSION); }
            catch (e) { return reject(e); }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error("IndexedDB open blocked"));
        });
    }
    function idbGet(db, key) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readonly");
            const r = tx.objectStore(STORE).get(key);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    }
    function idbSet(db, key, value) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }
    function idbSetSafe(key, value) {
        if (_db) idbSet(_db, key, value).catch(() => { /* cache best-effort */ });
    }

    function readLegacyLS(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw == null ? undefined : JSON.parse(raw);
        } catch (e) { return undefined; }
    }

    // Load a key from the local cache (IndexedDB), migrating any even-older
    // localStorage value into IndexedDB on the way.
    async function loadLocal(key) {
        let val;
        if (_db) { try { val = await idbGet(_db, key); } catch (e) { val = undefined; } }
        if (val === undefined) {
            const legacy = readLegacyLS(key);
            if (legacy !== undefined) {
                val = legacy;
                idbSetSafe(key, val);
                try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
            }
        }
        return val === undefined ? null : val;
    }

    // ----- Server (Postgres) -----------------------------------------------
    async function serverGet(key) {
        const res = await fetch(ENDPOINT[key], { cache: "no-store" });
        if (!res.ok) throw new Error("GET " + key + " -> " + res.status);
        return await res.json();
    }
    async function serverPut(key, value) {
        const res = await fetch(ENDPOINT[key], {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(value),
        });
        if (!res.ok) throw new Error("PUT " + key + " -> " + res.status);
    }

    async function init() {
        try { _db = await openDB(); } catch (e) { _db = null; }

        // Local cache snapshot (also migrates legacy localStorage).
        const local = {};
        for (const key of KEYS) local[key] = await loadLocal(key);

        // Try the server.
        let server = null;
        try {
            const results = await Promise.all(KEYS.map(serverGet));
            server = {};
            KEYS.forEach((k, i) => { server[k] = Array.isArray(results[i]) ? results[i] : []; });
            serverMode = true;
        } catch (e) {
            serverMode = false;
            console.warn("BobigoDB: server unavailable — offline (IndexedDB cache).", e);
        }

        if (!serverMode) {
            for (const key of KEYS) cache[key] = local[key] || null;
            return;
        }

        // One-time migration: server empty but the browser has legacy data.
        const serverEmpty = KEYS.every((k) => !(server[k] && server[k].length));
        const localHasData = KEYS.some((k) => local[k] && local[k].length);
        if (serverEmpty && localHasData) {
            try {
                await fetch("/api/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sessions: local.bobigo_sessions || [],
                        companions: local.bobigo_companions || [],
                        projects: local.bobigo_projects || [],
                    }),
                });
                const results = await Promise.all(KEYS.map(serverGet));
                KEYS.forEach((k, i) => { server[k] = Array.isArray(results[i]) ? results[i] : []; });
                console.info("BobigoDB: migrated local browser data to PostgreSQL.");
            } catch (e) {
                console.error("BobigoDB: one-time import failed:", e);
            }
        }

        for (const key of KEYS) {
            cache[key] = server[key] || [];
            idbSetSafe(key, cache[key]); // keep the offline cache in sync
        }
    }

    const ready = init().catch((e) => {
        // Should not happen (init swallows its own errors), but never leave the
        // app without a usable store.
        console.error("BobigoDB: init failed hard:", e);
        for (const key of KEYS) if (cache[key] === undefined) cache[key] = null;
    });

    // ----- flush / public API ----------------------------------------------
    function scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(flush, FLUSH_DELAY);
    }
    async function flush() {
        flushTimer = null;
        const keys = Object.keys(writeQueue);
        for (const key of keys) {
            const value = writeQueue[key];
            delete writeQueue[key];
            if (serverMode) {
                try { await serverPut(key, value); }
                catch (e) { console.error("BobigoDB: PUT failed for", key, "(kept in local cache):", e); }
            }
            // In offline mode the value is already in the IndexedDB cache (set()).
        }
    }

    function getSync(key) {
        return cache[key] !== undefined ? cache[key] : null;
    }

    function set(key, value) {
        cache[key] = value;
        idbSetSafe(key, value);              // local offline cache
        if (ENDPOINT[key]) { writeQueue[key] = value; scheduleFlush(); }
    }

    function flushNow() {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        return flush();
    }

    global.addEventListener("pagehide", flushNow);
    global.addEventListener("visibilitychange", () => {
        if (global.document.visibilityState === "hidden") flushNow();
    });

    global.BobigoDB = { ready, getSync, set, flushNow, get isOnline() { return serverMode; } };
})(window);
