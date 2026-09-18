"""Test bootstrap: authenticate the whole suite as the admin user.

Auth is enforced by an HTTP middleware, so we can't use FastAPI dependency
overrides. Instead we set ``app.state.auth_test_user`` — a hook the middleware
honours ONLY when set (it never is in production). This lets the existing tests
keep hitting the (now protected) API without per-test login boilerplate.
"""

import pytest
from fastapi.testclient import TestClient

from backend.app import app


@pytest.fixture(scope="session", autouse=True)
def _auth_for_tests():
    # Entering the TestClient runs the lifespan (opens the DB pool, bootstraps
    # the admin). Log in to fetch the admin's id, then expose it to the middleware.
    try:
        with TestClient(app) as client:
            resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
            if resp.status_code == 200:
                app.state.auth_test_user = resp.json()["user"]
    except Exception:  # noqa: BLE001 — no DB: protected tests will 503 and skip
        pass
    yield
    if hasattr(app.state, "auth_test_user"):
        del app.state.auth_test_user
