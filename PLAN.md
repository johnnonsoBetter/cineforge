# CineForge — AI Film Studio · Hackathon Plan

> Codename **CineForge** (rename freely). One prompt → a creative-director AI builds the whole
> film on an interactive canvas, with every asset + provenance stored in Backblaze B2.

**Primary target:** Backblaze Generative Media Hackathon — deadline **Aug 3, 2026**, solo, weekend.
**Secondary target (reuse):** OpenAI Build Week — same codebase, OpenAI models routed through
Genblaze, canvas flow emphasized.

---

## 1. Vision (one sentence)

**An AI film studio that turns a single idea into a finished cinematic short — screenplay,
characters, scenes, keyframes, animated shots, and final cut — through a conversational creative
director, on an interactive canvas, with verifiable provenance for every frame.**

The innovation is **not** "we can generate a video." It's the **orchestration**: each stage feeds
the next with structured context so narrative, characters, environments, and camera continuity are
preserved end-to-end. That is exactly what this studio's `_studio/` process already encodes.

## 2. The unfair advantage — the brain already exists

The OpenAI Build Week doc says to build an `ai/` layer of chained specialist agents (planner →
story → scene → camera → image → video → editor). **You already wrote that** — it lives in
`_studio/` as prose specs. The build is porting it to code, not inventing it:

| OpenAI doc's "ai/" agent | Already specified in |
|---|---|
| Planner / Story agent | `_studio/story_synthesizer.md` (spine, microbeats, dialogue bar) |
| Scene / Character / Environment design | `characters/characters.json` DNA schema, `character_dna_schema.md` |
| Camera + prompt agent | `_studio/prompt_format.md` (5-layer, anti-slow-motion rules) |
| Image → Video generation | `_studio/runbook.md` stages 2–4, `grok_build_guide.md` |
| Editor / QC agent | `_studio/qc_gate.md` (PASS/FAIL, regen budget, drift check) |
| Provenance / manifest | `episode.json` manifest logging |

We keep the brain, swap the hands: **Grok CLI → Genblaze**, **local disk → B2**.

## 3. Why it wins each hackathon

**Backblaze** (judged on real-world utility, production readiness, B2 usage, Genblaze usage):
- Utility: a real studio for creators/agencies producing consistent episodic short-form.
- Production readiness: autonomous QC gate + bounded regen + drift check + provider fallback.
- B2: every screenplay, character sheet, environment plate, keyframe, clip, VO, thumbnail **and
  provenance manifest** lives in B2; the canvas library reads back from B2.
- Genblaze: multi-provider image→video→audio orchestration through one `Pipeline`, native
  SHA-256 provenance, iteration/fallback driving the QC loop.

**OpenAI Build Week** (judged on the experience): the canvas + conversational creative director is
the memorable single-flow demo; route generation through Genblaze's OpenAI adapters (Sora,
gpt-image, TTS). Same app, different emphasis.

## 4. Genblaze / B2 primitive mapping

| Studio concept | Genblaze / B2 |
|---|---|
| 5-stage pipeline | `Pipeline` / `Step` / `Run` (`chain=True`) |
| Image-first consistency | image→video chain: `GMICloudImageProvider` (Seedream) → `GMICloudVideoProvider` (`kling-image2video`) |
| Manifest logging | `Manifest` — SHA-256 provenance, embeddable + persisted to B2 |
| QC gate + regen budget | `AgentLoop` / `from_result()` / `fallback_models=[...]` + vision-LLM judge |
| Drift check | parent-linked runs (`parent_run_id`) |
| Locked reference sheets | reusable character/environment asset stored once in B2, re-fed per shot |
| VO | `ElevenLabsTTSProvider` step |
| Story synthesizer | LLM `chat()` planner/story/scene agents |
| `final_clips/` on disk | `ObjectStorageSink(S3StorageBackend.for_backblaze(bucket), HIERARCHICAL)` |
| OpenAI reuse | swap provider class to `SoraProvider` / `DalleProvider` / OpenAI `chat()` |

## 5. Architecture

```
Interactive Canvas (React + Vite + React Flow + Tailwind)
   nodes: Story · Characters · Environments · Scenes · Keyframes · Shots · Timeline
   conversation panel (intent) · node inspector (preview + regenerate) · provenance drawer
        │  REST + SSE (live stage updates)
        ▼
FastAPI backend (Python — Genblaze is Python-only)
  backend/
    app.py                 REST + SSE endpoints
    config.py              env + MOCK_MODE (runs keyless)
    models.py              pydantic project/scene/asset/provenance schemas
    ai/
      director.py          orchestrator — runs the stage graph, streams progress
      story.py             brief → screenplay → scene breakdown  (chat())
      design.py            character + environment sheets
      camera.py            5-layer shot prompt builder (from prompt_format.md)
      qc.py                vision-LLM PASS/FAIL + regen budget
    pipeline/
      genblaze_client.py   provider selection (GMICloud ↔ OpenAI), pipelines
      storage.py           B2 sink + library index (list/read manifests)
      provenance.py        manifest extract / verify / summarize
```

Genblaze is a library (no daemon) — it embeds directly in FastAPI handlers. State lives in B2;
the backend stays stateless. The canvas is a **living graph**: each node stores `parent_id`s, so
editing a character can flag downstream keyframes/shots as stale and offer targeted regeneration.

## 6. Build strategy — walking skeleton (de-risks the ambitious UI)

Build depth-first so a full demo exists at every checkpoint; never a broad half-wired canvas.

- **M0 — Skeleton (keyless).** FastAPI + `MOCK_MODE` returns placeholder assets; canvas renders
  Story→Scene→Shot nodes from a prompt. End-to-end flow visible with zero API keys. *Always demoable.*
- **M1 — Real generation, one path.** Wire Genblaze: character sheet → keyframe → image2video for
  ONE scene, stored to B2 with a real manifest. Provenance drawer shows the real hash.
- **M2 — Full pipeline.** Multi-scene screenplay, environments, per-shot QC + regen, VO.
- **M3 — Canvas depth.** Node inspector, conversational edits, stale-downstream detection +
  targeted regenerate, timeline assembly.
- **M4 — Polish + submit.** Landing, deploy (working URL), record 3-min demo, write B2/Genblaze
  usage, list providers/models.

If the weekend runs out, you still ship at whatever milestone you reach — each is a coherent demo.

## 7. Demo story (design-first, one continuous flow)

1. Empty canvas. User types: *"A comedy about a Nigerian man who goes to a wedding expecting VIP
   treatment."*
2. "Understanding story…" → Screenplay node appears.
3. Character + Environment nodes bloom (Simeon, the bride, the wedding hall).
4. Scene board fills — Scene 1…4 as connected cards.
5. Keyframe nodes render under each scene (cinematic stills).
6. Shots animate (image→video), thumbnails go live.
7. User says *"make the ending more emotional"* → only the affected downstream nodes regenerate.
8. Timeline assembles → final short plays. Click any asset → provenance (prompt, model, hash).

Every step visibly shows the AI **advancing one film**, not exposing separate tools.

## 8. What you (human) provide — mechanical

- **Backblaze B2**: account + bucket + `B2_KEY_ID` / `B2_APP_KEY` (free 10GB).
- **GMI Cloud**: `GMI_API_KEY` (submit credits form; first 270 get credits).
- Optional: `ELEVENLABS_API_KEY` (VO), `OPENAI_API_KEY` (QC vision judge now; OpenAI Build Week later).
- Register on Devpost, star the Genblaze repo, pick a deploy target for the working URL.

## 9. Submission checklist (Backblaze / Devpost)

- [ ] Working app URL · [ ] Public GitHub repo + setup · [ ] Providers/models list
- [ ] B2 + Genblaze usage writeup (Sections 3–4 are the draft) · [ ] ~3-min demo video

---

*Orchestration is the product. The locked reference protects consistency. The QC gate protects
quality. B2 is the durable, provenance-verified record. Same operating principle as the studio —
new rails, and a face you can show a judge.*
