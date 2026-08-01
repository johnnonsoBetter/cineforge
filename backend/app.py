"""CineForge API — FastAPI over the Creative Director. Streams stage/node events to the
canvas via Server-Sent Events so nodes appear live as generation progresses."""
from __future__ import annotations

import time
from pathlib import Path
from typing import Iterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from . import auth, models
from .ai import director, entities, gate, qc
from .config import get_config
from .pipeline import export, storage

cfg = get_config()
app = FastAPI(title="CineForge", version="0.2.0")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


def _is_public(path: str) -> bool:
    """Routes that don't require a signed-in caller.

    Two kinds: assets reached outside `fetch` — an <img>/<video> src or a download link,
    which can't carry a bearer header and where a token must never ride a URL — and the
    public read surface (the gallery and public-project view), which is meant to be seen by
    anyone. A token is still honoured on these when present, so an owner stays themselves.
    """
    return (path == "/api/health"
            or path == "/api/gallery"
            or path.startswith("/api/media/")
            or path.startswith("/api/public/")
            or path.endswith("/export/download")
            or path.endswith("/export/film.mp4"))


@app.middleware("http")
async def authenticate(request, call_next):
    """Resolve every `/api/*` request to a user before the route runs.

    With auth off (no Supabase env) every caller is the single `local` user, so the zero-key
    dev/mock loop is untouched. With auth on, a valid token identifies the caller; a missing
    or bad one is a 401 on protected routes, and the anonymous caller on public ones.
    """
    path = request.url.path
    if not path.startswith("/api/") or not auth.AUTH_ENABLED:
        auth.set_current_user(auth.LOCAL_USER)
        return await call_next(request)

    header = request.headers.get("Authorization", "")
    token = header[7:] if header.startswith("Bearer ") else None
    user = auth.verify_token(token) if token else None
    if user is None and not _is_public(path):
        return JSONResponse({"detail": "authentication required"}, status_code=401)
    auth.set_current_user(user or auth.ANON_USER)
    return await call_next(request)


def _owner_scope() -> str | None:
    """The owner to scope a library read to — the caller when auth is on, else everyone."""
    return auth.current_user().id if auth.AUTH_ENABLED else None


def _sse(gen: Iterator[models.StageEvent], project: models.Project | None = None) -> StreamingResponse:
    """Serialize an event stream.

    Two things happen here rather than inside the director, so there is exactly one place
    that owns them:
      * entity tokens are resolved to current names on the way out;
      * the project is checkpointed after every node, so a client that disconnects
        mid-generation doesn't lose work that was already generated and paid for.
    """
    def stream():
        try:
            for event in gen:
                if event.node is not None and project is not None:
                    event = event.model_copy(update={
                        "node": entities.node_view(event.node, project.display_names())})
                    storage.save_async(project)
                yield f"data: {event.model_dump_json()}\n\n"
        finally:
            if project is not None:
                storage.save(project)  # runs on disconnect too — generators get closed
    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _require(project_id: str) -> models.Project:
    p = storage.get(project_id)
    if not p:
        raise HTTPException(404, "project not found")
    # Ownership is enforced as a 404, not a 403: a stranger shouldn't even learn the id exists.
    if auth.AUTH_ENABLED and p.owner_id and p.owner_id != auth.current_user().id:
        raise HTTPException(404, "project not found")
    return p


def _require_readable(project_id: str) -> models.Project:
    """Like `_require`, but also grants read access to a public film regardless of owner.

    The read surface behind share links and the template gallery: the owner sees their film
    as always, and anyone else sees it only while it is public — a re-privatised film goes
    back to a 404 for strangers.
    """
    p = storage.get(project_id)
    if not p:
        raise HTTPException(404, "project not found")
    if p.visibility == models.Visibility.PUBLIC:
        return p
    return _require(project_id)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "mock_mode": cfg.MOCK_MODE,
        "provider_stack": cfg.PROVIDER_STACK,
        "ready_for_real": cfg.ready_for_real(),
        # Text and media go live independently — the badge should say which.
        "text_live": not cfg.mock_text(),
        "media_live": not cfg.mock_media(),
        "storage": "b2" if cfg.has_b2() else "local",
    }


@app.post("/api/projects")
def create_project(req: models.CreateProjectRequest):
    p = models.Project(idea=req.idea, title=req.title or "Untitled Film",
                       settings=req.settings or models.ProjectSettings(),
                       owner_id=auth.current_user().id)
    p.ensure_stages()
    storage.save(p)
    return {"project_id": p.project_id}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    """Full project with entity tokens resolved and back-references attached."""
    return entities.project_view(_require(project_id))


@app.get("/api/public/projects/{project_id}")
def get_public_project(project_id: str):
    """Read-only view of a public film — the target of a share link and template preview.

    Anonymous callers are allowed (see the middleware): a public film is meant to be seen.
    A private film is a 404 here, exactly as it is to a stranger everywhere else.
    """
    p = storage.get(project_id)
    if not p or p.visibility != models.Visibility.PUBLIC:
        raise HTTPException(404, "project not found")
    return entities.project_view(p)


@app.post("/api/projects/{project_id}/visibility")
def set_visibility(project_id: str, req: models.VisibilityRequest):
    """Make a film public (shareable + in the gallery) or private again. Owner only."""
    p = _require(project_id)
    p.visibility = req.visibility
    storage.save(p)
    return {"project_id": p.project_id, "visibility": p.visibility.value}


@app.post("/api/projects/{project_id}/clone")
def clone_project(project_id: str):
    """Fork a film into a new project the caller owns — the "Use this template" action.

    Reads a public film (or one the caller already owns), deep-copies the whole graph so the
    copy is fully editable, and hands back a fresh private project. Assets keep their durable
    URLs: the copy points at the same rendered frames until the caller regenerates them.
    """
    src = _require_readable(project_id)
    copy = src.model_copy(deep=True, update={
        "project_id": models._id("proj"),
        "owner_id": auth.current_user().id,
        "visibility": models.Visibility.PRIVATE,
        "forked_from": src.project_id,
    })
    storage.save(copy)
    return {"project_id": copy.project_id}


# ---- the staged run ---------------------------------------------------------
#
# The film is produced in gated passes rather than one sweep, so "generate" is not a single
# call that either finishes or doesn't. It is: run until the gate says stop, hand the
# decision to whoever owns it, and be resumable from exactly there.

@app.get("/api/projects/{project_id}/stages")
def stages(project_id: str):
    """The stage board — what is done, what is open, and what the run is waiting on."""
    p = _require(project_id)
    board = gate.board(p)
    storage.save(p)   # ensure_stages may have filled the board in for an older project
    return board


@app.get("/api/projects/{project_id}/run")
def run(project_id: str):
    """SSE — run one pass, then stop at its gate.

    Called with no arguments this both starts a film and continues one: passes that already
    cleared are skipped, so the client's job after approving a gate is simply to call this
    again. Every pass stops for the director — there is no run that flows through on its own.
    """
    p = _require(project_id)
    return _sse(director.run(p), p)


@app.post("/api/stages/approve")
def approve_stage(req: models.StageDecisionRequest):
    """Open a gate by hand, then tell the caller what the run may do next.

    The reviewer's verdict is left exactly as filed — the override is recorded beside it, so
    a stage pushed past a hold never reads afterwards as a stage that cleared.
    """
    p = _require(req.project_id)
    rec = director.approve_stage(p, req.stage, req.note)
    if not rec:
        raise HTTPException(409, "that stage is not waiting on a decision")
    storage.save(p)
    return {"stage": rec.model_dump(), "board": gate.board(p)}


@app.post("/api/stages/hold")
def hold_stage(req: models.StageDecisionRequest):
    """Refuse a stage — the director's own veto over a gate that was willing to pass."""
    p = _require(req.project_id)
    rec = director.hold_stage(p, req.stage, req.note)
    if not rec:
        raise HTTPException(404, "no such stage")
    storage.save(p)
    return {"stage": rec.model_dump(), "board": gate.board(p)}


@app.get("/api/projects/{project_id}/generate")
def generate(project_id: str):
    """SSE — an alias of `/run`, kept for clients that reach for the older name.

    There is no whole-film-in-one-call anymore: every pass stops at its gate, so this runs
    exactly one pass and hands the decision back, same as `/run`.
    """
    p = _require(project_id)
    return _sse(director.run(p), p)


@app.post("/api/edit")
def edit(req: models.EditRequest):
    p = _require(req.project_id)
    return _sse(director.run_edit(p, req.instruction, req.target_node_id), p)


@app.post("/api/edit/propose")
def propose_edit(req: models.EditRequest):
    """Read a note against the graph and describe the change — writing nothing.

    The composer shows the result above the input: the target, the field diff, and what it
    would cost. Approving it posts to `/api/edit/apply`. This is the first half of every
    conversational edit, and the half that spends nothing.
    """
    p = _require(req.project_id)
    return director.propose_edit(p, req.instruction, req.target_node_id)


@app.post("/api/edit/apply")
def apply_edit(req: models.ApplyEditRequest):
    """SSE — execute a proposal the director approved. The only half that writes.

    Regenerates the target and everything connected to it when something has been rendered;
    updates the bible text and spends nothing when it hasn't. Impact is re-derived here, so
    a proposal that aged between proposing and approving does the right thing rather than the
    proposed thing.
    """
    p = _require(req.project_id)
    return _sse(director.apply_edit(p, req), p)


@app.post("/api/regenerate")
def regenerate(req: models.RegenerateRequest):
    """SSE — re-runs generation for a single node and stales whatever inherited from it."""
    p = _require(req.project_id)
    return _sse(director.regenerate_node(p, req.node_id, req.note, req.skip), p)


@app.get("/api/shots/suggest")
def suggest_shot(project_id: str, node_id: str):
    """The next setup worth taking on this scene, and why. Renders nothing.

    Read-only and cheap on purpose: this fills the form in so a director can accept, adjust
    or ignore it. The recommendation is not a decision — taking the shot still is. `node_id`
    is the scene (+ Keyframe) or one of its frames (+ Shot); both read the same scene.
    """
    p = _require(project_id)
    out = director.suggest_setup(p, node_id)
    if not out:
        raise HTTPException(404, "no scene to shoot")
    return out


@app.post("/api/shots/add")
def add_shot(req: models.AddShotRequest):
    """SSE — shoot one more setup on an existing keyframe.

    Purely additive: the master frame is already approved, so this costs one animation and
    stales nothing. It is the canvas equivalent of calling for another angle.
    """
    p = _require(req.project_id)
    return _sse(director.add_shot(p, req.keyframe_id, req.spec()), p)


@app.post("/api/keyframes/add")
def add_keyframe(req: models.AddKeyframeRequest):
    """SSE — add another angle to a scene: a new still, plus the one clip animated from it.

    Where `/api/shots/add` re-animates an existing still, this composes a genuinely new frame
    at a new setup — the honest way to get a real close-up or reverse, which need their own
    still, not a re-animation of the wide. Costs one image and one clip; nothing goes stale.
    """
    p = _require(req.project_id)
    return _sse(director.add_keyframe(p, req.scene_id, req.spec()), p)


# ---- entity graph -----------------------------------------------------------

@app.get("/api/projects/{project_id}/impact")
def impact(project_id: str, node_id: str, change: str = Query("semantic",
                                                              pattern="^(rename|semantic)$")):
    """Dry-run a change: what gets rewritten for free vs what needs re-rendering."""
    p = _require(project_id)
    imp = entities.impact_of(p, node_id, change)
    return {"rewritten": imp.rewritten, "stale": imp.stale, "cost_hint": imp.cost_hint}


@app.get("/api/projects/{project_id}/qc")
def qc_ledger(project_id: str):
    """The run's QC record: what was reviewed, what cleared, and what a human still owes."""
    return qc.ledger(_require(project_id))


@app.get("/api/projects/{project_id}/references")
def references(project_id: str):
    """entity_id -> every node/field that depends on it."""
    p = _require(project_id)
    return {eid: [r.__dict__ for r in refs]
            for eid, refs in entities.back_references(p).items()}


@app.post("/api/entities/rename")
def rename_entity(req: models.RenameEntityRequest):
    """Rename a character/environment everywhere. Free: no frame is re-rendered."""
    p = _require(req.project_id)
    touched = entities.rename_entity(p, req.entity_id, req.new_name)
    if not touched:
        raise HTTPException(404, "entity not found")
    storage.save(p)
    return {"updated": [n.model_dump() for n in touched]}


# ---- takes ------------------------------------------------------------------

@app.post("/api/versions/select")
def select_version(req: models.SelectVersionRequest):
    """Accept an earlier take of a node. Costs nothing — that asset is already rendered.

    Whatever was built *from* the take we're replacing does go stale: a shot animated from
    keyframe take 2 is no longer a shot of take 1.
    """
    p = _require(req.project_id)
    node = p.get(req.node_id)
    if not node or not node.select_version(req.version):
        raise HTTPException(404, "no such take")
    touched = [node] + entities.mark_stale(p, node.node_id)
    # Switching takes is free, but it can invalidate a stage that already cleared — the
    # board has to say so rather than stay green over shots of a frame nobody is showing.
    director.resync_stages(p)
    storage.save(p)
    names = p.display_names()
    return {"updated": [entities.node_view(n, names).model_dump() for n in touched],
            "board": gate.board(p)}


@app.post("/api/qc/review")
def qc_review(req: models.QCReviewRequest):
    """Re-review a node's current take. Renders nothing — the pixels already exist.

    This is what makes QC an agent you can ask rather than a stamp applied once: a second
    opinion on a frame you're unsure about costs one text call, and lands on the take.
    """
    p = _require(req.project_id)
    node, report = director.review_node(p, req.node_id)
    if not node:
        raise HTTPException(404, "node not found")
    if not report:
        raise HTTPException(409, "nothing to review — this node has no asset")
    storage.save(p)
    return {"report": report.model_dump(),
            "updated": [entities.node_view(node, p.display_names()).model_dump()]}


@app.post("/api/qc/accept")
def qc_accept(req: models.QCAcceptRequest):
    """Overrule the gate on one node — a human looked and kept it anyway.

    The report is left exactly as filed; the override is recorded beside it. Rewriting the
    verdict would make the ledger claim a pass the reviewer never gave.
    """
    p = _require(req.project_id)
    node = p.get(req.node_id)
    if not node:
        raise HTTPException(404, "node not found")
    if not node.qc:
        raise HTTPException(409, "nothing to overrule — this node was never reviewed")

    node.data["qc_override"] = {"verdict": node.qc.verdict, "at": time.time()}
    node.status = models.NodeStatus.READY
    storage.save(p)
    return {"updated": [entities.node_view(node, p.display_names()).model_dump()]}


@app.post("/api/nodes/lock")
def lock_node(req: models.LockRequest):
    """Lock/unlock a node. A locked node is skipped by every regeneration path."""
    p = _require(req.project_id)
    node = p.get(req.node_id)
    if not node:
        raise HTTPException(404, "node not found")
    node.locked = req.locked
    storage.save(p)
    return {"updated": [entities.node_view(node, p.display_names()).model_dump()]}


# ---- final cut --------------------------------------------------------------

@app.post("/api/projects/{project_id}/export")
def export_project(project_id: str):
    """Stitch the rendered shots into one downloadable MP4."""
    p = _require(project_id)
    try:
        url = export.export_film(p)
    except export.ExportError as e:
        raise HTTPException(409, str(e))
    return {"export_url": url, "shots": len(export.ordered_shots(p))}


@app.get("/api/media/qc/{name}")
def qc_frame(name: str):
    """Serve a frame QC pulled out of a clip — the evidence behind a verdict on a shot."""
    if "/" in name or ".." in name:
        raise HTTPException(400, "bad name")
    f = Path(cfg.DATA_DIR) / "qc" / name
    if not f.exists():
        raise HTTPException(404, "not found")
    return FileResponse(f, media_type="image/jpeg")


@app.get("/api/media/{name}")
def media(name: str):
    """Serve locally-rendered mock clips."""
    if "/" in name or ".." in name:
        raise HTTPException(400, "bad name")
    f = Path(cfg.DATA_DIR) / "mock" / name
    if not f.exists():
        raise HTTPException(404, "not found")
    return FileResponse(f, media_type="video/mp4")


@app.get("/api/projects/{project_id}/export/download")
def download_export(project_id: str):
    """Serve a locally-rendered cut (the fallback when B2 isn't configured)."""
    f = export.OUT_DIR / f"{project_id}.mp4"
    if not f.exists():
        raise HTTPException(404, "no export rendered yet")
    return FileResponse(f, media_type="video/mp4", filename=f"{project_id}.mp4")


@app.get("/api/projects/{project_id}/export/film.mp4")
def stream_export(project_id: str):
    """Same local cut, but for inline `<video>` playback on the Final Film node — served
    without a download filename so the browser plays it in place rather than saving it."""
    f = export.OUT_DIR / f"{project_id}.mp4"
    if not f.exists():
        raise HTTPException(404, "no export rendered yet")
    return FileResponse(f, media_type="video/mp4")


# ---- library ----------------------------------------------------------------

@app.get("/api/library")
def library():
    return {"projects": storage.list_projects(_owner_scope())}


@app.get("/api/gallery")
def gallery():
    """The public template library shown on the homepage — every film marked public."""
    return {"projects": storage.list_public()}


@app.get("/api/assets")
def assets():
    return {"assets": storage.all_assets()}


# ---- serve the canvas (single-file frontend) ----
@app.get("/")
def index():
    f = FRONTEND / "index.html"
    if f.exists():
        return FileResponse(f)
    return JSONResponse({"msg": "CineForge API up. Frontend not built yet.",
                         "health": "/api/health"})


# SPA fallback — the canvas is a client-routed app (/, /p/:id), so any non-API path has to
# return index.html or a refresh/shared deep link would 404. Declared last so every real
# route above (incl. /api/*) still wins; API paths that fall through here stay a clean 404.
@app.get("/{full_path:path}")
def spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404, "not found")
    f = FRONTEND / "index.html"
    if f.exists():
        return FileResponse(f)
    return JSONResponse({"msg": "CineForge API up. Frontend not built yet.",
                         "health": "/api/health"})
