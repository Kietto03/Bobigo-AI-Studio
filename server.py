#!/usr/bin/env python3
"""Bobigo AI Studio — FastAPI entry (static UI, proxy, agent)."""

from backend.app import app, run

__all__ = ["app", "run"]

if __name__ == "__main__":
    run()
