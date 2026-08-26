"""Integration tests for the PostgreSQL-backed store endpoints.

These require a reachable database (docker compose up -d db). When Postgres is
unavailable the store endpoints return 503 and every test here is skipped, so
the suite stays green in environments without a database.
"""

import pytest
from fastapi.testclient import TestClient

from backend.app import app


def _reset_or_skip(client: TestClient) -> None:
    r = client.get("/api/sessions")
    if r.status_code == 503:
        pytest.skip("PostgreSQL not available")
    # Start each test from an empty store.
    client.put("/api/sessions", json=[])
    client.put("/api/companions", json=[])
    client.put("/api/projects", json=[])


def test_sessions_round_trip_preserves_extras():
    with TestClient(app) as client:
        _reset_or_skip(client)
        payload = [{
            "id": "t_s1", "title": "T", "pinned": True,
            "createdAt": "2026-08-01T10:00:00Z",
            "messages": [
                {"role": "user", "content": "hi", "text": "hi"},
                {"role": "assistant", "content": "yo",
                 "reasoning": "hmm", "toolEvents": [{"name": "x"}]},
            ],
        }]
        assert client.put("/api/sessions", json=payload).status_code == 200
        got = client.get("/api/sessions").json()
        assert len(got) == 1
        s = got[0]
        assert s["id"] == "t_s1" and s["title"] == "T" and s["pinned"] is True
        assert len(s["messages"]) == 2
        assert s["messages"][0]["text"] == "hi"
        assert s["messages"][1]["reasoning"] == "hmm"
        # JSONB extras survive the round trip losslessly
        assert s["messages"][1]["toolEvents"] == [{"name": "x"}]


def test_reconcile_deletes_removed_sessions_and_messages():
    with TestClient(app) as client:
        _reset_or_skip(client)
        client.put("/api/sessions", json=[
            {"id": "t_a", "title": "A", "messages": [{"role": "user", "content": "1"}]},
            {"id": "t_b", "title": "B", "messages": [{"role": "user", "content": "2"}]},
        ])
        # Drop t_a; keep t_b with an extra message.
        client.put("/api/sessions", json=[
            {"id": "t_b", "title": "B2", "messages": [
                {"role": "user", "content": "2"},
                {"role": "assistant", "content": "3"},
            ]},
        ])
        got = client.get("/api/sessions").json()
        assert [s["id"] for s in got] == ["t_b"]
        assert got[0]["title"] == "B2"
        assert len(got[0]["messages"]) == 2


def test_import_projects_and_companions():
    with TestClient(app) as client:
        _reset_or_skip(client)
        resp = client.post("/api/import", json={
            "projects": [{"id": "t_p", "name": "P", "instructions": "terse",
                          "knowledge": [{"name": "n", "text": "k"}]}],
            "companions": [{"id": "t_c", "name": "Aria", "emoji": "🎨",
                            "language": "vi",
                            "messages": [{"role": "user", "content": "hi"}]}],
        })
        assert resp.status_code == 200
        projects = client.get("/api/projects").json()
        companions = client.get("/api/companions").json()
        assert projects[0]["id"] == "t_p"
        assert projects[0]["knowledge"] == [{"name": "n", "text": "k"}]
        assert companions[0]["name"] == "Aria"
        assert len(companions[0]["messages"]) == 1


def test_companion_messages_isolated_from_sessions():
    with TestClient(app) as client:
        _reset_or_skip(client)
        client.put("/api/sessions", json=[
            {"id": "t_s", "messages": [{"role": "user", "content": "s"}]}])
        client.put("/api/companions", json=[
            {"id": "t_c", "name": "C", "messages": [{"role": "user", "content": "c"}]}])
        sessions = client.get("/api/sessions").json()
        companions = client.get("/api/companions").json()
        assert len(sessions[0]["messages"]) == 1
        assert sessions[0]["messages"][0]["content"] == "s"
        assert len(companions[0]["messages"]) == 1
        assert companions[0]["messages"][0]["content"] == "c"


def test_incremental_append_and_delete_session():
    """POST .../messages appends without rewriting; DELETE removes the session."""
    with TestClient(app) as client:
        _reset_or_skip(client)
        ok = client.put("/api/sessions", json=[
            {"id": "t_inc", "title": "Inc",
             "messages": [{"role": "user", "content": "a"}]}])
        assert ok.status_code == 200

        r = client.post("/api/t_inc/messages", json={
            "role": "assistant", "content": "b",
            "toolEvents": [{"name": "calculator"}],
        })
        assert r.status_code == 201
        assert r.json()["seq"] == 1  # appended after the existing message

        sessions = client.get("/api/sessions").json()
        assert len(sessions) == 1 and sessions[0]["id"] == "t_inc"
        assert len(sessions[0]["messages"]) == 2
        # JSONB extras survive incremental insert too
        assert sessions[0]["messages"][1]["toolEvents"] == [{"name": "calculator"}]

        # Deleting by id removes the session AND its messages.
        assert client.delete("/api/sessions/t_inc").status_code == 204
        assert client.get("/api/sessions").json() == []


def test_incremental_append_requires_content():
    with TestClient(app) as client:
        _reset_or_skip(client)
        assert client.post("/api/missing/messages", json={"role": "user"}).status_code == 400
