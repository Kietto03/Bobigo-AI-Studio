.PHONY: venv vendor lint format test frontend-test run clean

venv:
	python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

vendor:
	bash scripts/fetch_vendor.sh

lint:
	.venv/bin/ruff check .

format:
	.venv/bin/ruff format .

test:
	.venv/bin/pytest -q

frontend-test:
	npx vitest run

run:
	./run.sh

clean:
	rm -rf .pytest_cache .ruff_cache
	find . -name '__pycache__' -type d -not -path './.venv/*' -not -path './node_modules/*' -exec rm -rf {} +
