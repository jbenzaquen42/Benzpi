---
name: python-project
description: Use when implementing or debugging Python scripts, packages, tests, or lightweight services so the agent can align with the repo's Python tooling and verification workflow.
---

# Python Project

Use this skill when the dominant task is Python.

## First Pass

Inspect the repo for Python project signals:

```powershell
rg --files -g "pyproject.toml" -g "requirements*.txt" -g "uv.lock" -g "setup.cfg" -g "tox.ini" -g "pytest.ini" -g "mypy.ini" -g "ruff.toml"
rg --files -g "*.py" | Select-Object -First 50
```

Determine:
- package vs script project
- dependency manager
- test framework
- lint/type-check tools
- entrypoints

## Tool Selection

Use the repo's existing toolchain. Prefer this order only when the project supports it:

1. `uv`
2. `python -m ...`
3. `pytest`
4. `pip`

Do not introduce Poetry, Hatch, or another workflow unless the project already uses it.

## Implementation Rules

- Keep the code direct and readable
- Match import ordering and file layout already in the repo
- Avoid adding dependencies unless clearly required
- Prefer focused tests over broad speculative coverage

## Verification

Choose the smallest meaningful command:

```powershell
uv run pytest path\to\test_file.py
pytest path\to\test_file.py
python -m package.module
python script.py
```

If the task changes a library surface, run the relevant tests.
If the task changes a script or CLI, execute it with safe input.

## Common Checks

### Dependency Shape

- `pyproject.toml` usually means modern packaging and tool config
- `uv.lock` suggests `uv` should be preferred
- `requirements.txt` may indicate a simpler app or script workflow

### Test Shape

Look for:
- `tests/`
- `test_*.py`
- `*_test.py`
- pytest markers or config

### Type and Lint Tools

If present, use them selectively:
- `ruff`
- `mypy`
- `pyright`

Do not run every tool by default if a narrower verification step proves the change.
