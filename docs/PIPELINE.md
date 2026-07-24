# CineForge — Pipeline & Functionality Spec

_This document specs the CineForge pipeline **as it is actually built today**. Every stage,
gate, and side channel described here traces to code in `backend/` and `frontend/`. Where
something is mocked vs. wired to a real provider, that is called out explicitly._

For the product vision and hackathon framing, see [`PLAN.md`](../PLAN.md). For setup and the
API cheat-sheet, see [`README.md`](../README.md).

---

## 1. What CineForge is

One idea → a finished cinematic short. A conversational **creative director** turns a single
logline into a screenplay, a cast, locations, keyframes, animated shots, and a final cut — on
a living graph (React Flow canvas), with **verifiable provenance for every frame**.

The innovation is **orchestration, not generation**: each stage feeds the next with
structured context so narrative, characters, environments, and camera continuity are
preserved end to end.

The whole app runs **keyless** in `MOCK_MODE` — placeholder media, a sample screenplay, a
mock QC judge — so the entire flow is demoable with zero API keys. Text goes live on any LLM
key independently of media (see [§13](#13-configuration--capability-model)).

---

## 2. Architecture at a glance

```
Interactive Canvas (React + Vite + React Flow)
  Rail (stage board) · CineNode graph · Inspector · QC panel · Timeline / Cinema · Composer
        │  REST + SSE (live stage/node/qc/gate events)
        ▼
FastAPI backend (backend/app.py)
  ai/
    director.py     orchestrator — the 4 gated passes + the driver that gates between them
    story.py        synthesizer — idea → full bible + every prompt (the one creative pass)
    camera.py       5-layer prompt builder + the "ensure every prompt exists" backstop
    coverage.py     "what to shoot next" agent (LLM, with a coverage-ladder floor)
    route.py        intent router — free-text note → one node + change kind
    entities.py     entity/token layer — free renames, back-refs, impact
    qc.py           per-asset review agent (PASS/FAIL, regen budget, frame sampling)
    gate.py         per-stage gate — rolls a pass's verdicts into one open/hold decision
  pipeline/
    genblaze_client.py  generation spine (GMICloud ↔ OpenAI, mock ↔ real)
    storage.py          3-tier project store (memory → local disk → B2)
    provenance.py       Genblaze manifest → provenance summary
    export.py           stitch shots → one downloadable MP4
  config.py         env + the two independent mock switches
  models.py         the graph schemas (Node, Asset, QCReport, StageRecord, …)
```

Genblaze is a **library, not a daemon** — it embeds directly in the FastAPI handlers. State
lives in the project store; assets and manifests live in B2 when configured.

---

## 3. The core data model — a living graph

Everything is a **`Node`** on one graph (`backend/models.py`). Each node carries
`parent_ids`, so an upstream change can mark everything downstream stale and offer targeted
regeneration.

### Node kinds (`NodeKind`)

| Kind | Produced by | Is it "pixels"? |
|---|---|---|
| `story` | synthesis | no — assembled from the plan |
| `character` | synthesis (text) → sheets (render) | yes |
| `environment` | synthesis (text) → sheets (render) | yes |
| `scene` | synthesis | no — a plan the render passes walk |
| `keyframe` | keyframes | yes |
| `shot` | video | yes |
| `timeline` | video (assembly) | no — assembled from the graph |

`RENDERED = {character, environment, keyframe, shot}` — only these can be *re-rendered*.
`story`, `scene`, and `timeline` are assembled from the graph and become "current" again for
free once whatever moved beneath them settles.

### Node status (`NodeStatus`)

`pending → running → ready`, plus three exception states:
- `stale` — an upstream parent changed; this node no longer describes the film.
- `failed` — generation threw (timeout, rate-limit); the failure is recorded on the node's
  `qc` field so the canvas has exactly one place to read "what happened here."
- `flagged` — QC failed and there was no budget (or the fail wasn't hard enough) to re-render;
  needs a human.

Status is **derived from the QC verdict**, never set alongside it — a node can't show `ready`
over a report that failed (`_settle` in `director.py`).

### Takes, assets, provenance

- **`Version`** — every generation *appends* a take; none is ever overwritten. `node.asset`
  is always the accepted take, so everything downstream reads one field and never touches
  history. `select_version` accepts an earlier take for free (the pixels already exist).
- **`Asset`** — url, thumbnail, optional `duration_sec`, and `Provenance`.
- **`Provenance`** — mirror of a Genblaze manifest summary: provider, model, prompt, sha256,
  `manifest_uri`, `canonical_hash`, `verified`, `parent_run_id`. Persisted alongside the asset.

---

## 4. The four-pass gated pipeline

The film is **not built in one sweep**. It is built in four passes, and **every gate stops
for the director** — there is no mode in which a pass opens the next one.

```
SYNTHESIS ──gate──▶ SHEETS ──gate──▶ KEYFRAMES ──gate──▶ VIDEO ──▶ (assemble)
  write the film      render the        one still per       animate each
  + every prompt      founding refs      generation unit     still, then cut
```

`STAGE_KEYS = ["synthesis", "sheets", "keyframes", "video"]`

### Why gate at all

The stages get **progressively more expensive** and each **inherits the last one's
mistakes**. A wrong character sheet isn't one bad image — it's a whole film of the wrong
person. The gate is the point where that costs one re-render instead of a hundred.

### The key insight: only synthesis is creative

Synthesis writes the bible, cast, locations, breakdown **and every prompt** the three
generation passes will spend. So the three passes after it are purely **mechanical**: they
read a prompt off the graph and send it. That is what makes the first gate the one worth
standing at — **what the director approves at synthesis is literally what the rest of the
pipeline executes.**

### The generation unit

A **generation unit** is one clip: **one still, then one 8-second animation of that exact
still** (`SHOT_SECONDS = 8`). A unit == one *coverage* entry on a scene. It is the atom the
last two passes walk (`_units()` in `director.py`).

Consistency between the units of a scene comes from the **locked reference sheets they are
all composed against** — not from a shared master frame. That's why the sheets gate is the
hardest one.

---

### 4.1 Stage: `synthesis` — write the film

`director.stage_synthesis` → `story.plan` → `camera.ensure_prompts`

- The **only creative pass**, and the only gate that is about *words*.
- `story.plan(idea, settings)` asks an LLM for STRICT JSON (real whenever a text key exists,
  regardless of `MOCK_MODE`), or returns an on-theme **sample** ("The VIP Treatment") when
  keyless. Output is normalized hard (`_normalize`): ids slugged & de-duped, dangling
  character refs resolved or dropped, scenes renumbered, coverage capped at `MAX_COVERAGE = 4`.
- Production settings reach generation for real: `length_min` → scene/shot count
  (`target_scenes`/`target_shots`), `aspect` → render ratio, `language` → dialogue language,
  `style_preset` → the style block that **leads** whatever the LLM wrote.
- `camera.ensure_prompts` guarantees that after synthesis, **every** character, location, and
  generation unit carries a complete prompt. Anything the synthesizer left blank is composed
  from the 5-layer format. This is the backstop that makes the later passes pure execution.
- Everything lands on the canvas **as text, unrendered**: the whole shape of the film stands
  in front of the director before a single image is paid for.
- Idempotent: re-entering synthesis when a `story` node already exists is a no-op — it must
  never rewrite the film mid-run.

Nodes created: `story` (with `bible`, `beats`, `plan`), `character`×N, `environment`×N,
`scene`×N (each hung off the cast + location it was written for).

### 4.2 Stage: `sheets` — the founding references

`director.stage_sheets`

- Renders every **character sheet** and **environment plate** — one image each, via
  `gb.generate_image` at the project aspect ratio, seeded by the entity id.
- **Gated hardest**, because everything inherits them. This is the pass most worth stopping
  after.
- Builds only what is missing (`todo = [n for n in founding if not n.asset]`), so it's
  resumable.
- Each asset goes through the uniform QC gate ([§5](#5-the-qc-gate--per-asset)) with a budget
  of `QC_MAX_REGENS` (default 2).

### 4.3 Stage: `keyframes` — one still per unit

`director.stage_keyframes`

- Walks every generation unit; composes one still per unit against the locked sheets, at that
  unit's own framing (not a scene master framing).
- Its "preflight" is the sheets gate itself: reaching this pass means every sheet is approved,
  which is the only reason composing against them is safe.
- Skips units that already have a keyframe → resumable. Budget `QC_MAX_REGENS`.

### 4.4 Stage: `video` — animate, then cut

`director.stage_video` → `_assemble`

- For each unit with an approved still, `gb.image_to_video` animates **that exact still**
  (image→video) for 8s. Nothing is re-composed here — the frame the director approved is the
  frame that starts moving.
- Judged against its own still, on frames **sampled across the whole clip** (so a face that
  morphs at second four is caught). Budget `QC_MAX_VIDEO_REGENS` (default 1 — re-animation is
  the most expensive retry).
- **Voiceover**: one VO per scene, on its first unit only (`_add_vo` via `gb.tts`, ElevenLabs).
  Kept behind its own failure boundary — losing the VO never costs you the animation.
- **`_assemble`**: gathers every shot that survived its gate, in film order, into a single
  `timeline` node ("Final Film"). This is part of the video pass, not a stage of its own — a
  gate in front of a free, decision-free assembly would be a stop with no decision behind it.
  Re-entering re-cuts the same timeline rather than leaving a second one on the canvas.

---

## 5. The QC gate — per-asset

`backend/ai/qc.py`. QC is an **agent**, not a label: it has its own inputs (the pixels that
came back, the pixels they must match, the intent), its own structured output (`QCReport`),
and bounded authority to spend the regen budget.

### The uniform loop (`director._gated`)

Every generated asset — sheet, plate, keyframe, clip — goes through the same three steps:

```
render(attempt) → review → re-render on a hard FAIL, while budget remains
```

The gate is the same code for all four kinds; only the **checklist** and the **references**
differ, and both are QC's business, not the director's.

### What each kind is checked for (`CRITERIA`)

| Kind | Criteria | Critical (fatal alone) |
|---|---|---|
| character | brief, plate, style, integrity | **brief** |
| environment | brief, emptiness, style, integrity | **brief** |
| keyframe | identity, environment, framing, style, integrity | **identity** |
| shot | identity, continuity, motion, integrity | **identity, continuity** |

`CRITICAL = {identity, continuity, brief}` — a failed critical criterion fails the whole
asset on its own (a frame of the wrong person isn't "a frame with a problem," it's the wrong
frame).

### How a verdict is reached (`rollup`)

- Any critical criterion fails → **FAIL**
- ≥2 non-critical fails → **FAIL**
- exactly 1 soft miss → **BORDERLINE** (keep it, but flag it)
- none → **PASS**

`should_regenerate` = only a hard **FAIL**. `accepted` = PASS / BORDERLINE / SKIPPED.

### Making an asset lookable

- A still is one frame; a **clip is sampled into 3 frames** (`QC_FRAME_SAMPLES`) across its
  duration via ffmpeg (skipping the very first/last frames to avoid encoder black frames).
- Extracted frames are **kept and served** (`/api/media/qc/{name}`) — they are the evidence
  behind a verdict and are recorded in the report.
- Locally-hosted media (mock clips) is inlined as a `data:` URI so the vision model can load it.

### Sighted vs. mock

- **Sighted** review runs when media is real **and** a vision-capable key exists
  (`can_see()` → needs `OPENAI_API_KEY`). The judge is shown generated frames **then** the
  reference sheets, and returns per-criterion JSON.
- Otherwise a **structured mock** with the same shape stands in — and it deterministically
  fails ~1 in 5 first attempts, so the **regeneration loop is visible in a keyless run**
  instead of every frame sailing through.
- If frames can't be sampled or the judge errors/returns junk → **SKIPPED** (reported
  honestly, never rubber-stamped).

### The ledger (`qc.ledger`)

The run's QC record, all click-through: `reviewed`, `passed`, `pass_rate`, `regens_spent`,
`failing_criteria`, `needs_a_human` (unaccepted + not overridden), `overruled`, `unreviewed`,
and `sighted` (whether the judge could actually see). This is the number that answers "is
this production-ready?" — surfaced at `GET /api/projects/{id}/qc`.

---

## 6. The stage gate — per-pass

`backend/ai/gate.py`. The per-asset gate answers "is this frame good?" The **stage gate**
answers the question that controls spending: *given everything this pass produced, do we open
the next one?*

- `evaluate` rolls a stage's nodes into one `StageGate` verdict (`clear` | `hold`) with
  itemized `blockers`. A node blocks if it's failed, stale, or QC-unaccepted — **unless** it's
  locked or has a `qc_override` (a human already settled it).
- An **empty pass holds** (not clears): every pass is supposed to produce something, so an
  empty one didn't run.
- `decide` records **who** opened/held the gate **without touching what the reviewer found** —
  a director pushing past a hold is a second fact recorded beside the verdict, never a rewrite.
  (`StageGate.verdict` = what QC found; `decided_by` = who acted.)
- `board` renders the whole run as passes: `stages[]`, `next`, `awaiting`, `complete`. Open
  gates are **re-evaluated against the live graph** so a blocker fixed ten minutes ago stops
  being listed.

### Stage statuses (`StageStatus`)

`pending → running → awaiting` (done, nothing wrong, waiting on you) **or** `blocked` (gate
found something) → `approved` (human opened it; next pass may start).

### Ownership (`STAGE_OWNS`)

What each pass is *answerable for* is declared, not inferred from what it created — because
synthesis puts the cast on the canvas as text and sheets renders those same nodes:

```
synthesis → (story, scene)      sheets → (character, environment)
keyframes → (keyframe,)         video  → (shot, timeline)
```

---

## 7. The driver, resumability & idempotency

`director.run` runs the film **one pass at a time**, stopping at every gate:

```
for each stage in order:
    if already approved → skip
    mark running
    _refresh_stale(stage)   # rebuild what an upstream change invalidated
    STAGES[stage](project)  # build what's missing
    record owned nodes; evaluate the gate; emit it
    set awaiting/blocked; emit "done" with a waiting label; RETURN
```

`GET /api/projects/{id}/run` is therefore **both "start the film" and "continue it"** — the
difference is only how much of the board is already green. After approving a gate, the client
just calls `/run` again.

Because every stage **reads its inputs off the graph and builds only what is missing**, stages
are **idempotent and resumable**. A gate can sit open as long as the director takes; the plan
is persisted on the `story` node, so a later pass can run in a completely different request.

**Stale repair** (`_refresh_stale`): re-running a reopened stage rebuilds its own stale,
unlocked nodes — rendered ones get re-generated, assembled ones (scene) just flip back to
`ready`. Reaching a stage means every stage above it cleared, so a node stale only by
inheritance is already current — which is why a scene comes back free and a keyframe is paid for.

**Board resync** (`resync_stages`): a hand edit that stales a node three passes downstream
reopens exactly those approved stages, so the board never lies about work that has to happen
again.

---

## 8. The entity / token layer — free renames

`backend/ai/entities.py`. This is what makes the canvas a genuinely *living* graph.

**Problem:** a scene's prose used to embed names as literal strings (`"Simeon bargains…"`)
while the graph *also* recorded the link structurally (`character_ids: [SIMEON]`) — two copies
of one fact, guaranteed to drift on the first rename.

**Fix:** store text with **entity tokens**, resolve at render time.

```
stored :  "{{SIMEON}} bargains; {{USHER:lc}} does not blink"
shown  :  "Chidi bargains; the usher does not blink"
```

- Renaming is a **single write to one node** — every scene, logline, VO line, and **prompt**
  follows instantly, deterministically, **without re-rendering a single frame**.
- The `:lc` case hint lets role-nouns ("The Usher") lowercase mid-sentence, while proper names
  survive it.
- Tokens live on: story `logline/bible/beats/plan`, scene `title/action/vo/atmosphere/intent/
  coverage`, and every rendered node's `prompt`. The prompt being tokenised is the point where
  a "free" rename would otherwise quietly stop being free.
- **Resolution happens once**, in `app._sse` / `node_view`, on the way out — the frontend never
  knows tokens exist. Between the story gate and the cast stage, `display_names()` falls back to
  the plan's own names so nothing renders as `{{SIMEON}}`.
- **`back_references`** maps `entity_id → every node/field that depends on it` (structural edges
  + prose mentions). Powers the Inspector's "what breaks if I change this?" and scene CAST chips.
- **`impact_of`** dry-runs a change: `rename` → text-only, free; `semantic` → lists every
  descendant frame/shot needing a re-render. Surfaced at `GET …/impact` before you pay.

---

## 9. Conversational editing — propose → approve

The composer **does not** apply a note the instant it's typed. It **proposes**: works out what
the note would change, shows the field diff and what it would re-render, and waits. Nothing is
written or paid for until the director approves.

```
POST /api/edit/propose  → director.propose_edit  (writes nothing)
POST /api/edit/apply    → director.apply_edit    (the only half that writes)   [SSE]
```

### Proposing (`propose_edit`)

1. Resolve the target: an explicit canvas selection / @-mention always wins; otherwise the
   **intent router** (`route.py`) reads the note against the graph.
2. Classify the change:
   - **rename** — unambiguous & free; no field diff, just propagation. Detected by
     `route.rename_intent` even on an addressed note (so "call her Ada" stays free).
   - **field** — the note is really about one bible field (`character.dna`,
     `environment.desc`, `scene.action`). A text model rewrites *that one field* and the
     proposal shows a real before/after diff.
   - **note** — no diffable field (keyframe/shot), or no text model: carry the note into the
     prompt as-is.
3. Attach **real-pixel impact** (`_edit_impact`): a descendant counts as a re-render only if it
   has *actually been rendered* — so a note on a not-yet-designed character reads "text only,"
   not "3 assets."

### Applying (`apply_edit`)

Impact is **re-derived at apply time**, so a proposal that aged between proposing and approving
does the right thing rather than the proposed thing. Two paths:

- **Something rendered under the target** → change the bible text, then regenerate the node and
  everything connected to it (the normal note-driven regenerate path).
- **Nothing rendered yet** → change the bible text and **steer the stored prompt**
  (`_steer_future`), spending nothing — the pass that eventually renders it reads the edit off
  the graph. "The change is baked in for when that pass runs."
- **Rename** → re-resolve text everywhere, touch no frame.

(`POST /api/edit` / `director.run_edit` is the older one-shot path that applies immediately;
`propose`/`apply` is the current working surface.)

### The intent router (`route.py`)

Two tiers: an LLM pass that sees the actual node list and picks a target, and a keyword
heuristic for the keyless demo (named entity → positional "ending/opening" → explicit scene
number → title-word overlap). A clearly-phrased rename short-circuits both — never spend a
model call on it, never risk a mis-classification burning a re-render.

---

## 10. Targeted regeneration, add-shot, coverage

### Targeted regenerate (`director.regenerate_node`)

Re-runs generation for **one node in place**, then stales everything downstream. Every rendered
node carries the prompt it was made from, so a re-render is *that same prompt again* with the
director's note folded in (`camera.with_note` — a second note **replaces** the first, never
stacks). Cheap fixes stay cheap: a still re-renders alone; a clip re-animates from its
already-approved still. Locked nodes are skipped. A scene "regenerate" cascades into its
keyframes and shots. Endpoint: `POST /api/regenerate` (SSE).

### Add another setup (`director.add_shot`)

The canvas equivalent of calling for another angle. Buys **one image + one animation** — no
story rewrite, no re-rendered sheets, no downstream staling. The new unit is written the same
way synthesis writes them (via `camera.keyframe_prompt`/`video_prompt`) and **appended to the
scene's own coverage**, so it's indistinguishable from a planned unit everywhere downstream.
Endpoint: `POST /api/shots/add` (SSE).

### Coverage suggestion (`coverage.suggest`)

"What to shoot next, and why." Reads the scene + everything already in the can, and recommends
the **missing** frame — the reaction nobody covered, the insert the wide can't hold. LLM when a
key exists, with a **coverage ladder** floor (wide→closer→insert, biased by scene intent and
cast size) that is a real recommendation, not a placeholder. Renders nothing — it just fills the
form in. Endpoint: `GET /api/shots/suggest`.

---

## 11. Takes, locks, and the QC override

- **Version history / A-B compare** — `POST /api/versions/select` accepts an earlier take
  (free; stales what was built from the old one; the take's own QC verdict comes back with it).
- **Lock** — `POST /api/nodes/lock` marks a node so **every** regeneration path skips it. A
  lock is a promise the exact frame survives every downstream note; honored by both direct
  regenerate and scene cascades, and it exempts the node at the stage gate.
- **Re-review** — `POST /api/qc/review` re-reads existing pixels with the current criteria.
  The cheap half of the gate: a second opinion costs one text call, not a render. The verdict
  lands on both the node and the take.
- **Override** — `POST /api/qc/accept` keeps a take the gate didn't clear. The report is left
  exactly as filed; the override is recorded beside it (`data.qc_override`) so the ledger never
  claims a pass the reviewer never gave.

---

## 12. Generation spine & providers

`backend/pipeline/genblaze_client.py` is the one place that knows how to talk to a provider (or
fake it). The rest of the app never imports a provider directly.

| Call | Real (GMICloud stack) | Real (OpenAI stack) | Mock |
|---|---|---|---|
| `generate_image` | `GMICloudImageProvider` / `seedream-5.0-lite` | `DalleProvider` / `gpt-image-1` | picsum placeholder at the project aspect |
| `image_to_video` | `GMICloudVideoProvider` / `kling-image2video-v2.1-master` | `SoraProvider` / `sora-2` | **real ffmpeg MP4** rendered from the still |
| `tts` | — | — | `ElevenLabsTTSProvider` / `eleven_v3` (real key) else `mock://` |
| `chat` | GMI `llama-3.3-70b` | OpenAI `gpt-4o` | `""` (callers use their own fallback) |

- **`PROVIDER_STACK`** (`gmicloud` | `openai`) swaps the whole image/video/chat provider set
  with no other code changes — this is the OpenAI-Build-Week reuse path.
- Real image/video runs go through a Genblaze `Pipeline(...).step(provider, …).run(sink=B2)`,
  reading `asset.url` / `asset.sha256` and the run `manifest` back out.
- The **mock clip is a real, playable MP4**: it ffmpeg-crops the master still to match the
  requested **shot type** (`_FRAMING_ZOOM`) and drifts per the requested **move**, so a
  close-up genuinely reads as a close-up of the same frame the wide came from. That's the whole
  claim of the coverage model — the mock has to demonstrate it, or it hides the bug it exists
  to catch. Mock clips are cached by content hash.
- **`chat` is vision-capable**: `image_urls` become ordered image content parts (https or
  `data:`), which is what lets the QC judge compare generated frames against reference sheets in
  one call. Vision pins to OpenAI (the GMI text model can't see).

---

## 13. Configuration & capability model

`backend/config.py`. **Two independent mock switches**, because text and pixels have wildly
different economics:

- **text** (planner / router / coverage / QC reasoning) — cents. Goes live the moment **any**
  LLM key exists (`mock_text()` = no key). `MOCK_MODE` does **not** gate it, so a judge who
  types their own idea gets a bespoke screenplay, not a fixture.
- **media** (image / video / audio) — real money + minutes. Stays mocked until explicitly
  turned on: `MOCK_MEDIA` overrides, else follows `MOCK_MODE` (default `true`).

Capability probes drive the `/api/health` badge and behavior:

| Probe | Means |
|---|---|
| `mock_text()` | no LLM key → text is mocked |
| `can_see()` | `OPENAI_API_KEY` present → QC can actually look at pixels |
| `mock_media()` | images/video mocked |
| `has_b2()` | B2 credentials present → durable storage |
| `ready_for_real()` | B2 + (GMI or OpenAI) → a real paid run is possible |

Key env: `MOCK_MODE`, `MOCK_MEDIA`, `PROVIDER_STACK`, `B2_KEY_ID/APP_KEY/BUCKET/REGION`,
`GMI_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, model overrides
(`IMAGE_MODEL`/`I2V_MODEL`/`QC_MODEL`/…), `QC_MAX_REGENS` (2), `QC_MAX_VIDEO_REGENS` (1),
`QC_FRAME_SAMPLES` (3), `DATA_DIR`.

Run keyless:
```bash
MOCK_MODE=true uvicorn backend.app:app --reload --port 8000
```

---

## 14. Storage, provenance & export

### Project store (`pipeline/storage.py`) — 3 tiers

1. **memory** — the hot copy the SSE generators mutate in place.
2. **local disk** — always on, atomic writes (tmp + `os.replace`), so `--reload` mid-demo never
   loses a film.
3. **B2** — the canonical record when credentials exist (projects, manifests, exports all in one
   bucket; the library reads back from it).

Writes are best-effort and layered — a B2 outage degrades to local disk. `save_async` is called
after **every node** during a stream (disk now, B2 off-thread), so a client that disconnects
mid-generation keeps the half-film it already paid for.

### Provenance (`pipeline/provenance.py`)

`summarize_manifest` extracts provider/model/prompt/`canonical_hash`/`parent_run_id`/`verified`
from a real Genblaze manifest; `mock_provenance` synthesizes a believable, hash-stable manifest
in mock mode. Surfaced per asset via `GET /api/assets` (the provenance drawer / library).

### Export (`pipeline/export.py`)

`POST /api/projects/{id}/export` stitches the surviving shots **in story order** (reached
through each shot's keyframe→scene parent, so a regenerated shot still cuts in the right place)
into one MP4. Each shot is re-encoded to a common geometry/fps/audio (not stream-copy concat,
which silently corrupts on mismatched inputs); a scene's VO is mixed over its own segment. The
result goes to B2 when configured, else a local `/export/download` path.

---

## 15. API reference

### Project & run
| Method · Path | Purpose |
|---|---|
| `GET /api/health` | status + capability badges |
| `POST /api/projects` | create from `{ idea, title?, settings? }` → `{ project_id }` |
| `GET /api/projects/{id}` | full project, tokens resolved, back-refs attached |
| `GET /api/projects/{id}/stages` | the stage board (done / open / next / awaiting) |
| `GET /api/projects/{id}/run` | **SSE** — run one pass, stop at its gate; also the resume call |
| `GET /api/projects/{id}/generate` | alias of `/run` (older clients) |
| `POST /api/stages/approve` | open a gate `{ project_id, stage, note? }` |
| `POST /api/stages/hold` | veto a stage the gate would have passed |

### Editing & generation
| Method · Path | Purpose |
|---|---|
| `POST /api/edit/propose` | describe a note's change + cost — writes nothing |
| `POST /api/edit/apply` | **SSE** — execute an approved proposal (the only writing half) |
| `POST /api/edit` | **SSE** — one-shot conversational edit (older path) |
| `POST /api/regenerate` | **SSE** — re-render one node, stale downstream |
| `GET /api/shots/suggest` | next setup to shoot, and why (renders nothing) |
| `POST /api/shots/add` | **SSE** — shoot one more setup off a keyframe |

### Entities, takes, QC
| Method · Path | Purpose |
|---|---|
| `GET /api/projects/{id}/impact` | dry-run a change (`rename` free vs `semantic` paid) |
| `GET /api/projects/{id}/references` | `entity_id → dependents` |
| `POST /api/entities/rename` | rename everywhere (free, no re-render) |
| `GET /api/projects/{id}/qc` | the QC ledger |
| `POST /api/qc/review` | re-review a take (renders nothing) |
| `POST /api/qc/accept` | overrule the gate on one node |
| `POST /api/versions/select` | accept an earlier take (free) |
| `POST /api/nodes/lock` | lock/unlock a node against regeneration |

### Final cut, media, library
| Method · Path | Purpose |
|---|---|
| `POST /api/projects/{id}/export` | stitch shots → one MP4 |
| `GET /api/projects/{id}/export/download` | serve a locally-rendered cut |
| `GET /api/media/{name}` · `GET /api/media/qc/{name}` | mock clips · QC evidence frames |
| `GET /api/library` · `GET /api/assets` | library cards · flat asset+provenance list |

---

## 16. The SSE event model

Generation/edit endpoints **stream** `StageEvent` frames (`EventSource` can't POST, so the
client parses `data:` frames itself — `frontend/src/api.js`). Event `type`s:

| type | Carries | The canvas does |
|---|---|---|
| `stage` | `label` | prints a director line ("Designing Simeon…") |
| `node` | `node` | adds/updates a node (tokens resolved on the way out) |
| `progress` | `stage, done, total` | drives the production monitor bar |
| `qc` | `qc, node_id` | shows the reviewer's verdict as it lands |
| `stage_status` | `stage, stage_status` | updates the stage board / Rail |
| `gate` | `stage, gate` | narrates the gate decision that closed the pass |
| `done` | `label` | the run stopped — and whether it's the director's move |
| `error` | `label` | a recoverable problem, in the director's voice |

`stage` (director), `progress` (monitor), and `qc` (reviewer) are deliberately separate voices
so none drowns the others. The project is checkpointed after every `node` event.

---

## 17. Current status (what works vs. what's next)

**Working & verified in mock mode (keyless):**
- The full four-pass gated pipeline, resumable and idempotent, with per-asset QC + bounded
  regen and per-stage gates.
- React Flow canvas: nodes bloom live over SSE; Inspector, QC panel, Rail/stage board,
  Timeline / Cinema mode, Composer.
- Conversational edits (propose → approve), intent routing, entity/token **free renames**,
  impact preview + dependency highlight, per-node version history with A/B compare, locks, QC
  override, add-shot, coverage suggestion.
- Production settings (length / style / aspect / language) that reach generation for real.
- Real, playable mock MP4s that honor shot type + camera move; final-cut export via ffmpeg.
- 3-tier persistence; mock provenance manifests; the QC ledger.
- **Text is genuinely live** on any LLM key: a typed idea produces a bespoke screenplay, and
  sighted QC runs with an `OPENAI_API_KEY`.

**The one thing left — M1, real generation:** wire Genblaze GMICloud (image→video) + B2 storage
by setting keys and `MOCK_MODE=false`. Because everything above already runs through the same
code paths (`genblaze_client.py`), this is a **provider swap, not new plumbing**.

---

_Every claim here is grounded in current code. When you change a stage, a gate, a criterion, or
an endpoint, update the matching section so this stays the spec and not a snapshot._
