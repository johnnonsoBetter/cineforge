# CineForge

AI film studio — one idea → screenplay, characters, environments, keyframes, animated shots and
final cut, on an interactive canvas, with verifiable provenance for every frame stored in
Backblaze B2. Built on **Genblaze** + **B2**. See `PLAN.md` for the full plan.

## Status

- **M0 — skeleton (done, verified).** FastAPI backend streams the full creative-director pipeline
  over SSE; runs with **zero API keys** in `MOCK_MODE`.
- **M2/M3 — full pipeline + canvas depth (done, verified in mock mode).** React Flow canvas,
  conversational edits, entity/token layer with free renames, impact preview + dependency
  highlight, per-node version history with A/B compare, locks, production monitor, story
  bible + beat sheet + per-scene intent, production settings (length/style/aspect/language).
- **Gated stages (done, verified in mock mode).** The film is produced in seven passes —
  story → cast → locations → breakdown → storyboards → animation → final cut — with a gate
  between each pair. In `auto` the review agent opens the next gate itself and **halts the
  run** when anything in the pass is outstanding; in `manual` every pass waits for the
  director. Stages are idempotent and resumable, so a note that stales work three passes
  downstream reopens exactly those passes and the next run repairs them.
- **M1 — real generation (next, and the only thing left).** Wire Genblaze (GMICloud
  image→video) + B2 storage. Everything above already runs through the same code paths, so
  this is a provider swap rather than new plumbing.

## Run the backend (mock mode — no keys)

```bash
cd cineforge
pip install -r backend/requirements.txt
MOCK_MODE=true uvicorn backend.app:app --reload --port 8000
```

- `GET  /api/health` — status
- `POST /api/projects` `{ "idea": "...", "gate_mode": "auto"|"manual" }` → `{ project_id }`
- `GET  /api/projects/{id}/run` — **SSE**: runs stage by stage, stopping at the first gate
  that needs a human. Also the *resume* call — cleared stages are skipped, so continuing
  after an approval is the same request again. `?stop_after=keyframes` for the cheap
  storyboard pass; `?gate_mode=` switches who opens the gates mid-film.
- `GET  /api/projects/{id}/stages` — the stage board: what cleared, what is open, what next
- `POST /api/stages/approve` `{ project_id, stage, note }` — open a gate; `…/hold` to veto one
- `GET  /api/projects/{id}/generate` — the one-call shorthand (`?mode=draft` = stop after
  storyboards). Still halts at any gate that needs a human.
- `POST /api/edit` `{ project_id, instruction, target_node_id }` — conversational edit (SSE)
- `GET  /api/projects/{id}/impact?node_id=&change=` — blast radius of a change, before paying
- `POST /api/versions/select` — accept an earlier take (free; stales what was built from the old one)
- `POST /api/nodes/lock` — lock a take so regeneration skips it
- `GET  /api/library` · `GET /api/assets` — library + provenance

## Go live (M1)

```bash
pip install genblaze-core genblaze-gmicloud genblaze-s3 genblaze-elevenlabs
cp backend/.env.example backend/.env   # fill B2_KEY_ID, B2_APP_KEY, GMI_API_KEY; set MOCK_MODE=false
```

Switch `PROVIDER_STACK=openai` to route through OpenAI models (Sora / gpt-image) for the
OpenAI Build Week reuse — no other code changes.

## Layout

```
backend/
  app.py                 FastAPI + SSE
  config.py  models.py   config (+MOCK_MODE) · graph schemas (nodes carry parent_ids)
  ai/  director.py        the seven stage passes + the driver that gates between them
       gate.py            stage gate — rolls a pass's verdicts into one open/hold decision
       story.py           planner/story/scene agents (brief → structured breakdown)
       camera.py          5-layer prompt builder (ports prompt_format.md)
       qc.py              per-asset PASS/FAIL review + regen budget
  pipeline/ genblaze_client.py  generation spine (GMICloud ↔ OpenAI, mock ↔ real)
            storage.py           project + library store
            provenance.py        Genblaze manifest → provenance summary
frontend/                canvas (React + React Flow) — next milestone
```
