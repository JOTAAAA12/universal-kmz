---
name: kmz-clinical-orchestrator
description: Orchestrate clinical audit, execution, Docker bring-up, harness validation, model routing, and multi-agent quality assurance for the Leitor KMZ / universal-kmz app. Use for requests to test, harden, debug, containerize, or guarantee KMZ/KML parsing, Google geocoding provenance, address extraction, exports, and UI behavior.
---

# KMZ Clinical Orchestrator

## Purpose

Run Leitor KMZ work as an auditable delivery loop: map context, split lanes,
prove failures, patch narrowly, validate with native gates, and report evidence.

Use this skill with `google-maps-platform-integration` for Google Maps,
reverse geocoding, browser/server key separation, and provenance-sensitive
address enrichment.

## Model Routing

- Lead/maestro: use `gpt-5.5` with high or max reasoning for architecture,
  security, trade-offs, final consolidation, and risky fixes.
- Background work: use cheaper models such as `gpt-5.4-mini` for file search,
  fixture expansion, repetitive test matrix work, and read-only audits.
- Technical precision: use `gpt-5.3-codex-spark` for narrow exact tasks such as
  line references, command syntax, type errors, small diffs, and focused
  regression triage.
- Do not claim unavailable models. If a named external model is unavailable in
  the active Codex surface, use the closest available frontier model and state
  the routing clearly.

## Workflow

1. Load the Prompt Engineering Gate and local/canonical memory before action.
2. Inspect `E:\Leitor KMZ\universal-kmz` and prefer native scripts in
   `package.json`.
3. Maintain a phase checklist and update it after each major transition.
4. Split parallel lanes when useful:
   - parser/KMZ extraction
   - Google geocoding and security
   - UI/export behavior
   - harness/tests
   - Docker/runtime
5. Reproduce bugs before patching.
6. Add or extend regression coverage for confirmed bugs.
7. Run at minimum:
   - `npm.cmd run test:precision`
   - `npm.cmd run lint`
   - `npm.cmd run build`
   - Docker build/up and HTTP smoke when Docker is in scope
8. For live Google geocoding, require a temporary process-level
   `GOOGLE_MAPS_SERVER_KEY`; never write secrets into `.env`, compose files, or
   memory.
9. Report pass/fail evidence, residual risk, and any work requiring real
   credentials or paid provider calls.

## Docker Contract

- Keep container files under `universal-kmz`.
- Do not mount host system directories.
- Prefer production build in the image and expose only the app port.
- Use `docker compose down` before `docker compose up -d --build`.
- Validate with `docker compose ps`, `docker compose logs`, and an HTTP request
  to `127.0.0.1`.

## Safety Boundaries

- Do not run destructive Git commands.
- Preserve unrelated user changes.
- Do not store secrets.
- Do not silently enable mock geocoding for real validation.
- Do not treat Google-enriched city/UF as original KMZ provenance.

## Outputs

- Updated plan/checklist.
- Focused patches, tests, or Docker files.
- Command evidence.
- Findings ordered by severity.
- Residual risk and required follow-up.
