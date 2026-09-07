"""Auth: password hashing (pure) + real login/scoping/admin flow (needs DB)."""

import contextlib

import pytest
from fastapi.testclient import TestClient

from backend import auth
from backend.app import app


def test_password_hash_roundtrip():
    h = auth.hash_password("s3cret")
    assert h.startswith("pbkdf2$")
    assert auth.verify_password("s3cret", h)
    assert not auth.verify_password("wrong", h)
    # different salt each call
    assert auth.hash_password("s3cret") != h


@contextlib.contextmanager
def _no_test_hook():
    """Temporarily disable the conftest auto-auth so we can test real gating."""
    saved = getattr(app.state, "auth_test_user", None)
    if hasattr(app.state, "auth_test_user"):
        del app.state.auth_test_user
    try:
        yield
    finally:
        if saved is not None:
            app.state.auth_test_user = saved


def _db_up(client) -> bool:
    # /api/sessions is protected: 401 (no auth) when DB up, 503 when DB down.
    return client.get("/api/sessions").status_code == 401


def test_login_and_gating():
    with _no_test_hook(), TestClient(app) as client:
        if not _db_up(client):
            pytest.skip("DB unavailable")
        # wrong password
        assert client.post("/api/auth/login", json={"username": "admin", "password": "nope"}).status_code == 401
        # correct password sets a session cookie
        r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200 and r.json()["user"]["role"] == "admin"
        assert auth.COOKIE_NAME in r.cookies
        # now authed
        assert client.get("/api/sessions").status_code == 200
        assert client.get("/api/auth/me").json()["user"]["username"] == "admin"
        # admin can list users
        assert client.get("/api/admin/users").status_code == 200


def test_non_admin_forbidden_and_isolated():
    with _no_test_hook(), TestClient(app) as client:
        if not _db_up(client):
            pytest.skip("DB unavailable")
        client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        # create a throwaway user
        uname = "pytest_user"
        client.post("/api/admin/users", json={"username": uname, "password": "pw123456"})
        # switch identity on the same client (avoid nesting TestClient contexts,
        # which would tear down the shared lifespan resources)
        client.cookies.clear()
        client.post("/api/auth/login", json={"username": uname, "password": "pw123456"})
        assert client.get("/api/admin/users").status_code == 403      # not admin
        assert client.get("/api/sessions").json() == []               # own (empty) data
        # back to admin, clean up
        client.cookies.clear()
        client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        users = client.get("/api/admin/users").json()["users"]
        uid = next(x["id"] for x in users if x["username"] == uname)
        client.request("DELETE", f"/api/admin/users/{uid}")


def test_admin_monitoring_and_governance():
    with _no_test_hook(), TestClient(app) as client:
        if not _db_up(client):
            pytest.skip("DB unavailable")
        # Anonymous access blocked
        assert client.get("/api/admin/monitoring").status_code == 401
        assert client.get("/api/admin/governance").status_code == 401

        # Login as admin
        client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})

        # Monitoring response
        mon = client.get("/api/admin/monitoring")
        assert mon.status_code == 200
        mdata = mon.json()
        assert "cluster" in mdata
        assert "host" in mdata["cluster"]
        assert "worker" in mdata["cluster"]
        assert "llm" in mdata
        assert "db" in mdata

        # Governance response
        gov = client.get("/api/admin/governance")
        assert gov.status_code == 200
        gdata = gov.json()
        assert "summary" in gdata
        assert "guardrails" in gdata
        assert "allowed_tools" in gdata["guardrails"]

