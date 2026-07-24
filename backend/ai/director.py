"""The Creative Director — orchestrates the whole graph and streams user-facing progress.

Emits StageEvents the canvas turns into nodes appearing live. Labels are user-centered
("Designing the characters…"), never agent/tool names. This is the studio's runbook
expressed as four gated passes:

    SYNTHESIS  write the film — bible, cast, locations, breakdown, and every prompt
    SHEETS     render the founding character sheets and location plates
    KEYFRAMES  one still per generation unit, composed against those locked sheets
    VIDEO      animate each still; cut the approved clips together

Only the first pass is creative. Synthesis front-loads all three prompt sets, so the three
after it are mechanical: they read a prompt off the graph and send it. That is what makes
the first gate the one worth standing at — what the director approves there is literally
what the rest of the pipeline executes.

A **generation unit** is one clip: one still, then one 8-second animation of that exact
still. Consistency between the units of a scene comes from the locked reference sheets they
are all composed against, not from a shared master frame — which is why the sheets gate is
the hardest one.

Every gate stops. There is no mode in which a pass starts itself. The stages get more
expensive as they go and each inherits the last one's mistakes, so the gate is the point
where a wrong character sheet costs one re-render instead of a whole film of the wrong
person.
"""
from __future__ import annotations
import time
from typing import Iterator
from ..config import get_config
from .. import models
from ..models import (Project, Node, NodeKind, NodeStatus, Asset, QCReference,
                      StageEvent, StageRecord, StageStatus, SHOT_SECONDS)
from ..pipeline import genblaze_client as gb
from . import story as story_agent
from . import camera
from . import coverage
from . import entities
from . import gate
from . import qc as qc_agent
from . import route

cfg = get_config()


def _ev(label=None, node=None, project_id=None, type="stage") -> StageEvent:
    # Nodes are stored tokenised ("{{SIMEON}} bargains…"); resolution to current entity
    # names happens once, in app.py's SSE serializer, on the way out.
    return StageEvent(type=type, label=label, node=node, project_id=project_id)


def _progress(stage: str, done: int, total: int, project_id: str) -> StageEvent:
    """One tick of the production monitor. A real run spends minutes inside image and video
    calls; without this the canvas looks hung rather than busy."""
    return StageEvent(type="progress", stage=stage, done=done, total=total,
                      project_id=project_id)


def _prompt_scene(project: Project, scene: dict) -> dict:
    """Tokens are a storage detail — the models must see real names.

    Every prompt is built from this, never from the raw stored scene, otherwise a keyframe
    prompt would literally read "{{SIMEON}} bargains, name-drops".
    """
    names = project.entity_names()
    out = dict(scene)
    for f in ("title", "action", "vo", "atmosphere", "intent"):
        if out.get(f):
            out[f] = entities.resolve(str(out[f]), names)
    if out.get("coverage"):
        out["coverage"] = entities.resolve_deep(out["coverage"], names)
    return out


# ---- the QC gate, applied uniformly ----------------------------------------
#
# Every generated asset goes through the same three steps: render, review, and — only on a
# hard fail, and only while there is budget — render again. The gate is the same code for a
# character sheet, an environment plate, a keyframe and a clip; what differs is the
# checklist and the references, and both of those are the QC agent's business, not the
# director's.


def _qc_ev(node: Node, report, project_id: str) -> StageEvent:
    """The reviewer speaking in the run, as it happens."""
    return StageEvent(type="qc", label=f"{node.title} — {qc_agent.headline(report)}",
                      qc=report, node_id=node.node_id, project_id=project_id)


def _reference(node: Node) -> QCReference | None:
    """A finished character/environment node, as something the judge can look at."""
    if not (node and node.asset and node.asset.url):
        return None
    what = "character sheet" if node.kind == NodeKind.CHARACTER else "location plate"
    return QCReference(url=node.asset.url, label=f"{node.title} ({what})", node_id=node.node_id)


def _master_of(project: Project, shot: Node) -> Node | None:
    """The keyframe a shot was filmed from. Every shot has exactly one."""
    return next((p for p in (project.get(x) for x in shot.parent_ids)
                 if p and p.kind == NodeKind.KEYFRAME), None)


def _scene_of(project: Project, keyframe: Node) -> Node | None:
    """The scene a keyframe is the master of."""
    return next((p for p in (project.get(x) for x in keyframe.parent_ids)
                 if p and p.kind == NodeKind.SCENE), None)


def _target_for(project: Project, node: Node, note: str | None = None) -> "qc_agent.Target":
    """The brief a node's asset is judged against, derived from the graph.

    One builder for every path — the first pass, a targeted regenerate, or a re-review asked
    for long after the run — so a take is never graded on a different curve than the one it
    replaced. Everything it needs is already on the canvas: the node's own description, the
    scene it hangs off, and the approved sheets hanging off that.
    """
    style = _style_of(project, note)

    if node.kind == NodeKind.CHARACTER:
        return qc_agent.Target(
            intent=f"Character reference sheet for {node.title}: {node.data.get('dna', '')}. "
                   f"Film style: {style}")

    if node.kind == NodeKind.ENVIRONMENT:
        return qc_agent.Target(
            intent=f"Unpopulated establishing plate of {node.title}: "
                   f"{node.data.get('desc', '')}. Film style: {style}")

    if node.kind == NodeKind.KEYFRAME:
        scene_node = _scene_of(project, node)
        if not scene_node:
            return qc_agent.Target(intent=f"{node.title}. Film style: {style}")
        scene, _dna, env = _scene_context(project, scene_node)
        refs, cast = _scene_review_context(project, scene_node)
        unit = node.data.get("coverage") or {}
        return qc_agent.Target(
            # Judged against the sheets, not against a sibling frame: the sheets are the
            # only thing every unit of the scene has in common, so they are the only fair
            # thing to hold each one to.
            intent=(f"The still for one shot of scene {scene.get('n', '')}. "
                    f"{cast or 'the cast'} in {env}: "
                    f"{unit.get('action') or scene.get('action', '')}. "
                    f"Framing: {node.data.get('setup') or 'as staged'}. This is the first "
                    f"frame of a clip, so faces, wardrobe and lighting must be legible and "
                    f"must match the reference sheets. Film style: {style}"),
            references=refs)

    if node.kind == NodeKind.SHOT:
        master = _master_of(project, node)
        # The clip is held against its own still: same frame, now moving.
        refs = ([QCReference(url=master.asset.url, label="approved still", node_id=master.node_id)]
                if master and master.asset and master.asset.url else [])
        cov = node.data.get("coverage") or {}
        return qc_agent.Target(
            intent=(f"A {SHOT_SECONDS}s clip animated from its own approved still — "
                    f"{node.data.get('setup') or 'as framed'}, "
                    f"{cov.get('move', 'locked camera')}. "
                    f"{cov.get('action', '')} "
                    f"The source image is the first frame: same location, cast, wardrobe and "
                    f"lighting throughout, at natural real-time pace. Film style: {style}"),
            references=refs)

    return qc_agent.Target(intent=f"{node.title}. Film style: {style}")


def _gated(node: Node, kind: NodeKind, generate, target: "qc_agent.Target",
           budget: int, project_id: str):
    """Render → review → re-render on a hard fail, up to `budget` extra renders.

    `generate(attempt)` returns a GenResult; the attempt index is threaded through so each
    retry gets a fresh seed rather than re-rolling the identical frame.

    Yields the reviewer's events and returns `(asset, report, attempt)` to the caller via
    `yield from` — the gate narrates itself while staying one expression at the call site.
    """
    attempt = 0
    while True:
        res = generate(attempt)
        asset = Asset(kind=kind, url=res.url, thumbnail=res.thumbnail,
                      duration_sec=res.duration_sec, provenance=res.provenance)
        report = qc_agent.review(kind, asset, target, attempt=attempt)
        yield _qc_ev(node, report, project_id)
        if not qc_agent.should_regenerate(report) or attempt >= budget:
            return asset, report, attempt
        yield StageEvent(type="stage", project_id=project_id,
                         label=f"{qc_agent.headline(report)} Re-rendering {node.title}…")
        attempt += 1


def _settle(node: Node, asset: Asset, report, attempt: int, *, note: str | None = None) -> None:
    """Record a gated result on its node — the take, its review, and what that means.

    Status is derived from the verdict rather than set alongside it, so a node can never
    show READY over a report that failed.
    """
    node.push_version(asset, note=note, qc=report)
    node.attempt = attempt
    node.status = NodeStatus.READY if qc_agent.accepted(report) else NodeStatus.FLAGGED


def _prompt_of(project: Project, node: Node) -> str:
    """The prompt this node's asset is made from, ready to send.

    Every rendered node carries the prompt synthesis wrote for it. It is stored tokenised,
    like all prose on the graph, and resolved here — at the one point where it stops being
    something the director reads and becomes something a model is paid to execute.
    """
    return entities.resolve(node.data.get("prompt") or "", project.entity_names())


def _repoint(project: Project, node: Node, note: str | None) -> str:
    """Fold a director's note into a node's stored prompt, and keep it there.

    The note edits the prompt rather than decorating the call, so the inspector always shows
    what actually made the frame in front of it.
    """
    if note:
        node.data["prompt"] = camera.with_note(node.data.get("prompt") or "", note)
    return _prompt_of(project, node)


def _safe(node: Node, what: str):
    """Context manager: a failed generation marks its node FAILED and the run continues.

    Real image/video calls take 30–300s and *will* time out or rate-limit mid-run. One
    exception used to kill the SSE stream and strand the project half-built; now the node
    carries the failure, the stream survives, and the existing regenerate endpoint is the
    retry path.
    """
    from contextlib import contextmanager

    @contextmanager
    def cm():
        try:
            yield
        except Exception as e:
            node.status = NodeStatus.FAILED
            # Expressed as a report so the canvas has exactly one field to read for
            # "what happened to this node", whether QC judged it or it never got that far.
            node.qc = qc_agent.error_report(what, e)
    return cm()


def _add_vo(project: Project, shot: Node, line: str) -> Iterator[StageEvent]:
    """Voice the scene's spoken line and hang it off the shot.

    Kept separate from the shot's own failure boundary: losing the voiceover should never
    cost you the animation you already rendered.
    """
    if not line:
        return
    try:
        res = gb.tts(entities.resolve(line, project.entity_names()))
    except Exception:
        return
    if res.url and not res.url.startswith("mock://"):
        shot.data["vo_url"] = res.url
        shot.data["vo_provenance"] = res.provenance.model_dump()
    yield from ()


# ---- the stages ------------------------------------------------------------
#
# The film is not built in one sweep. It is built in four passes, each of which is a thing a
# director would want to look at before paying for the next one: the plan, then the founding
# references, then the frames, then the motion.
#
# Every stage reads its inputs off the graph rather than off a local variable, and builds
# only what is missing. That is what lets a stage be re-entered — an hour later, after a
# note, after a regeneration — and still do exactly the work that is left rather than a
# second copy of the work that is done.

def _story_node(project: Project) -> Node | None:
    return next((n for n in project.nodes if n.kind == NodeKind.STORY), None)


def _plan(project: Project) -> dict:
    """The screenplay the whole run is spending against, kept on the story node.

    Persisted rather than held in memory because a later stage may run in a completely
    different request — the gate between them can sit open for as long as the director takes
    to look.
    """
    n = _story_node(project)
    return (n.data.get("plan") if n else None) or {}


def _units(project: Project) -> Iterator[tuple[Node, dict, int, dict]]:
    """Every generation unit in the film, in film order.

    A unit is one coverage entry: one still, then one clip animated from that exact still.
    It is the atom the last two stages walk, so both walk *this* rather than each rederiving
    what a unit is.
    """
    for scene_node in project.by_kind(NodeKind.SCENE):
        scene = scene_node.data
        for i, unit in enumerate(scene.get("coverage") or []):
            yield scene_node, scene, i, unit


def _keyframe_for(project: Project, scene_node: Node, i: int) -> Node | None:
    return next((c for c in project.children_of(scene_node.node_id)
                 if c.kind == NodeKind.KEYFRAME and c.data.get("i") == i), None)


def _shot_of(project: Project, keyframe: Node) -> Node | None:
    return next((c for c in project.children_of(keyframe.node_id)
                 if c.kind == NodeKind.SHOT), None)


def stage_synthesis(project: Project) -> Iterator[StageEvent]:
    """Write the film — and every prompt the three generation passes will spend.

    The only creative pass, and the only one whose gate is about words. Cast, locations and
    scenes all land on the canvas here as text, unrendered: the whole shape of the film
    stands in front of the director before a single image has been paid for.
    """
    pid = project.project_id
    if _story_node(project):
        return   # the film is already written; re-entering this stage must not rewrite it

    yield _ev(label="Writing the film…", project_id=pid)
    yield _progress("synthesis", 0, 1, pid)
    cfgp = project.settings
    plan = entities.tokenize_plan(story_agent.plan(project.idea, cfgp))
    project.title = plan.get("title", project.title)
    project.story_source = plan.get("_source", "sample")
    # The chosen preset leads; whatever the story agent wrote follows it.
    style = story_agent.style_block(cfgp.style_preset, plan.get("style", ""))
    # Anything synthesis left blank is composed now, so that after this line every entity and
    # every unit in the plan carries a complete prompt and nothing downstream invents one.
    plan = camera.ensure_prompts(plan, style)

    story = project.add(Node(kind=NodeKind.STORY, title=project.title,
                             status=NodeStatus.READY,
                             data={"style": style, "logline": project.idea,
                                   "source": project.story_source,
                                   "bible": plan.get("bible", {}),
                                   "beats": plan.get("beats", []),
                                   "plan": plan}))
    yield _ev(type="node", node=story, project_id=pid)

    for c in plan.get("characters", []):
        n = project.add(Node(kind=NodeKind.CHARACTER, title=c["name"],
                             status=NodeStatus.PENDING, parent_ids=[story.node_id],
                             data={"id": c["id"], "dna": c.get("dna", ""),
                                   "prompt": c.get("sheet_prompt", "")}))
        yield _ev(type="node", node=n, project_id=pid)

    for e in plan.get("environments", []):
        n = project.add(Node(kind=NodeKind.ENVIRONMENT, title=e["name"],
                             status=NodeStatus.PENDING, parent_ids=[story.node_id],
                             data={"id": e["id"], "desc": e.get("desc", ""),
                                   "prompt": e.get("plate_prompt", "")}))
        yield _ev(type="node", node=n, project_id=pid)

    for scene in plan.get("scenes", []):
        # Hung off the cast and location it was written for, so every later stage reads a
        # scene's DNA blocks and its plate straight off the graph.
        parents = [story.node_id]
        for cid in scene.get("character_ids", []):
            c = project.entity_node(cid)
            if c:
                parents.append(c.node_id)
        env = project.entity_node(scene.get("environment_id"))
        if env:
            parents.append(env.node_id)
        n = project.add(Node(
            kind=NodeKind.SCENE, title=f"Scene {scene['n']}: {scene.get('title','')}",
            status=NodeStatus.READY, parent_ids=parents, data=scene))
        yield _ev(type="node", node=n, project_id=pid)

    yield _progress("synthesis", 1, 1, pid)


def stage_sheets(project: Project) -> Iterator[StageEvent]:
    """The founding references — every character sheet and every location plate.

    Gated hardest, because everything inherits them. A wrong sheet is not one bad frame; it
    is a whole film of the wrong person. This is the pass most worth stopping after.
    """
    pid = project.project_id
    aspect = project.settings.aspect
    founding = project.by_kind(NodeKind.CHARACTER) + project.by_kind(NodeKind.ENVIRONMENT)
    todo = [n for n in founding if not n.asset]
    if not todo:
        return

    yield _ev(label="Rendering the reference sheets…", project_id=pid)
    done = len(founding) - len(todo)
    yield _progress("sheets", done, len(founding), pid)
    for n in todo:
        what = "character sheet" if n.kind == NodeKind.CHARACTER else "location plate"
        yield _ev(label=f"Designing {n.title}…", project_id=pid)
        n.status = NodeStatus.RUNNING
        yield _ev(type="node", node=n, project_id=pid)
        with _safe(n, what):
            prompt, seed = _prompt_of(project, n), n.data.get("id", n.node_id)
            asset, report, attempt = yield from _gated(
                n, n.kind,
                lambda a: gb.generate_image(prompt, seed=f"{seed}-{a}", aspect_ratio=aspect),
                _target_for(project, n), cfg.QC_MAX_REGENS, pid)
            _settle(n, asset, report, attempt)
        done += 1
        yield _ev(type="node", node=n, project_id=pid)
        yield _progress("sheets", done, len(founding), pid)


def stage_keyframes(project: Project) -> Iterator[StageEvent]:
    """One still per generation unit, composed against the locked reference sheets.

    Preflight is the sheets gate itself: reaching this pass means every sheet the film is
    built from has been approved, which is the only reason composing against them is safe.
    """
    pid = project.project_id
    aspect = project.settings.aspect
    units = list(_units(project))
    if not units:
        return

    done = sum(1 for s, _sc, i, _u in units if _keyframe_for(project, s, i))
    yield _progress("keyframes", done, len(units), pid)
    for scene_node, scene, i, unit in units:
        if _keyframe_for(project, scene_node, i):
            continue
        n = scene.get("n", "")
        multi = len(scene.get("coverage") or []) > 1
        setup = f"{unit.get('shot','')}, {unit.get('angle','')}".strip(", ")
        yield _ev(label=f"Framing scene {n} — {setup}…", project_id=pid)
        kf = project.add(Node(
            kind=NodeKind.KEYFRAME, title=f"Frame {n}" + (f".{i + 1}" if multi else ""),
            status=NodeStatus.RUNNING, parent_ids=[scene_node.node_id],
            # The unit lives on the node: it is what this frame exists to be the first frame
            # of, and what a re-render has to reproduce. `coverage` holds this single unit.
            data={"n": n, "i": i, "scene_title": scene.get("title", ""), "setup": setup,
                  "coverage": unit, "prompt": unit.get("keyframe_prompt", "")}))
        with _safe(kf, "keyframe"):
            prompt = _prompt_of(project, kf)
            asset, report, attempt = yield from _gated(
                kf, NodeKind.KEYFRAME,
                lambda a: gb.generate_image(prompt, seed=f"{n}-{i}-{a}", aspect_ratio=aspect),
                _target_for(project, kf), cfg.QC_MAX_REGENS, pid)
            _settle(kf, asset, report, attempt)
        done += 1
        yield _ev(type="node", node=kf, project_id=pid)
        yield _progress("keyframes", done, len(units), pid)


def stage_video(project: Project) -> Iterator[StageEvent]:
    """Animate every approved still, then cut the result together.

    The expensive pass, and the reason the three gates before it exist at all. Each clip
    starts from its own unit's still, so nothing is re-composed here — the frame the director
    approved is the frame that starts moving.
    """
    pid = project.project_id
    aspect = project.settings.aspect
    units = [(s, sc, i, u, kf) for s, sc, i, u in _units(project)
             if (kf := _keyframe_for(project, s, i))]
    if not units:
        return

    total = len(units)
    done = sum(1 for *_x, kf in units if _shot_of(project, kf))
    yield _progress("video", done, total, pid)

    for scene_node, scene, i, unit, kf in units:
        if _shot_of(project, kf):
            continue
        done += 1
        if not kf.asset:
            # No still to animate — tick anyway so the bar still reaches its total instead of
            # stalling on a unit whose frame already failed.
            yield _progress("video", done, total, pid)
            continue

        n = scene.get("n", "")
        multi = len(scene.get("coverage") or []) > 1
        yield _ev(label=f"Shooting scene {n} — {kf.data.get('setup', '')}…", project_id=pid)
        shot = project.add(Node(
            kind=NodeKind.SHOT, title=f"Shot {n}" + (f".{i + 1}" if multi else ""),
            status=NodeStatus.RUNNING, parent_ids=[kf.node_id],
            data={"vo": scene.get("vo", ""), "n": n, "i": i,
                  "setup": kf.data.get("setup", ""), "coverage": unit,
                  "prompt": unit.get("video_prompt", "")}))
        with _safe(shot, "animation"):
            prompt = _prompt_of(project, shot)
            # Judged against the still it was animated from, on frames sampled across the
            # whole clip — that's how a face that morphs at second four is caught.
            asset, report, attempt = yield from _gated(
                shot, NodeKind.SHOT,
                lambda _a: gb.image_to_video(kf.asset.url, prompt, duration=SHOT_SECONDS,
                                             aspect_ratio=aspect,
                                             framing=unit.get("shot"), move=unit.get("move")),
                _target_for(project, shot), cfg.QC_MAX_VIDEO_REGENS, pid)
            _settle(shot, asset, report, attempt)
            # One voiceover per scene, on its first unit — repeating the line on every setup
            # would stammer it.
            if i == 0:
                yield from _add_vo(project, shot, scene.get("vo", ""))
        yield _ev(type="node", node=shot, project_id=pid)
        yield _progress("video", done, total, pid)

    yield from _assemble(project)


def _assemble(project: Project) -> Iterator[StageEvent]:
    """The cut — every clip that survived its gate, in film order.

    Part of the video pass rather than a stage of its own: assembling a timeline costs
    nothing and decides nothing, and a gate in front of it would be a stop with no decision
    behind it.
    """
    pid = project.project_id
    shots = sorted(project.by_kind(NodeKind.SHOT),
                   key=lambda s: (s.data.get("n") or 0, s.data.get("i") or 0))
    if not shots:
        return

    yield _ev(label="Assembling the film…", project_id=pid)
    ids = [s.node_id for s in shots]
    timeline = next((n for n in project.by_kind(NodeKind.TIMELINE)), None)
    if timeline:
        # Re-entering the pass after a note re-cuts the same timeline rather than leaving a
        # second Final Film on the canvas.
        timeline.parent_ids, timeline.data["shots"] = ids, ids
        timeline.status = NodeStatus.READY
    else:
        timeline = project.add(Node(kind=NodeKind.TIMELINE, title="Final Film",
                                    status=NodeStatus.READY, parent_ids=ids,
                                    data={"shots": ids}))
    yield _ev(type="node", node=timeline, project_id=pid)


STAGES = {
    "synthesis": stage_synthesis,
    "sheets": stage_sheets,
    "keyframes": stage_keyframes,
    "video": stage_video,
}

# What each pass is answerable for at its gate, by kind.
#
# Declared rather than inferred from which nodes a run happened to create: synthesis puts the
# cast on the canvas as text and the sheets pass renders those same nodes, so "created it"
# and "answerable for it" are genuinely different questions. A gate that read the first would
# let the sheets pass clear with nothing in it.
STAGE_OWNS = {
    "synthesis": (NodeKind.STORY, NodeKind.SCENE),
    "sheets": (NodeKind.CHARACTER, NodeKind.ENVIRONMENT),
    "keyframes": (NodeKind.KEYFRAME,),
    "video": (NodeKind.SHOT, NodeKind.TIMELINE),
}


def owned_nodes(project: Project, key: str) -> list[str]:
    kinds = STAGE_OWNS.get(key, ())
    return [n.node_id for n in project.nodes if n.kind in kinds]


# ---- the driver ------------------------------------------------------------

def _stage_ev(rec: StageRecord, pid: str) -> StageEvent:
    return StageEvent(type="stage_status", stage=rec.key, stage_status=rec.status,
                      project_id=pid)


def _gate_ev(rec: StageRecord, pid: str) -> StageEvent:
    """The gate speaking in the run, in the same voice the reviewer uses per asset."""
    verb = "cleared" if rec.gate.verdict == "clear" else "held"
    return StageEvent(type="gate", stage=rec.key, gate=rec.gate, project_id=pid,
                      label=f"{rec.label} — {verb}. {rec.gate.summary}")


def _closing(project: Project) -> str:
    """Close on what the gate actually found. 'Your film is ready' over three frames the
    reviewer rejected would be the one dishonest line in the whole run."""
    failed = [n.title for n in project.nodes if n.status == NodeStatus.FAILED]
    flagged = [n.title for n in project.nodes if n.status == NodeStatus.FLAGGED]
    led = qc_agent.ledger(project)
    if failed:
        return f"Film assembled — {len(failed)} shot(s) need a retry: {', '.join(failed[:3])}"
    if flagged:
        return (f"Film assembled. QC cleared {led['passed']} of {led['reviewed']} assets; "
                f"{len(flagged)} still need your eye: {', '.join(flagged[:3])}")
    return (f"Your film is ready — all {led['reviewed']} assets cleared QC"
            + (f" after {led['regens_spent']} re-render(s)." if led["regens_spent"] else "."))


def _waiting_label(rec: StageRecord) -> str:
    """What the director has to do for the run to continue."""
    if rec.status == StageStatus.BLOCKED:
        return (f"Held at {rec.label.lower()} — {rec.gate.summary} "
                f"Fix or keep them, then approve the stage to continue.")
    return (f"{rec.label} is done and waiting on you. Approve it and I'll start "
            f"the next stage.")


# Kinds that exist as pixels somebody paid for, as against kinds that are assembled from
# the graph. Only the first sort can be *re-rendered*; the second sort is stale only in the
# sense that something under it moved, and is current again as soon as that has settled.
RENDERED = {NodeKind.CHARACTER, NodeKind.ENVIRONMENT, NodeKind.KEYFRAME, NodeKind.SHOT}


def _refresh_stale(project: Project, key: str) -> Iterator[StageEvent]:
    """Rebuild whatever this pass owns that an upstream change invalidated.

    A stage builds what is missing; this is the other half — what is present but no longer
    true. Without it, re-running a reopened stage would sail past its own stale nodes and
    re-gate a pass it never actually redid.

    Reaching a stage at all means every stage above it has cleared its gate, so a node that
    was only stale by inheritance is current again by the time we are standing here. That is
    why a scene comes back for free and a keyframe has to be paid for.
    """
    for nid in owned_nodes(project, key):
        n = project.get(nid)
        if not n or n.status != NodeStatus.STALE or n.locked:
            continue
        if n.kind in RENDERED:
            yield from _regen(project, nid)
        else:
            n.status = NodeStatus.READY
            yield _ev(type="node", node=n, project_id=project.project_id)


def run(project: Project) -> Iterator[StageEvent]:
    """Run the film one pass at a time, stopping at every gate.

    Stages already approved are skipped, so this is both "start the film" and "continue from
    where the director left it" — the difference is only how much of the board is already
    green. A run does exactly one pass and hands the decision back, which is the whole point:
    the next pass costs more than this one and inherits everything it got wrong. There is no
    mode in which a pass opens the next one; only a human does.
    """
    pid = project.project_id
    project.ensure_stages()

    for key in models.STAGE_KEYS:
        rec = project.stage(key)
        if rec.status == StageStatus.APPROVED:
            continue

        rec.status = StageStatus.RUNNING
        rec.started_at = rec.started_at or time.time()
        yield _stage_ev(rec, pid)

        yield from _refresh_stale(project, key)
        yield from STAGES[key](project)
        # What this pass is answerable for, by kind — a stage that only repaired what an
        # earlier pass left behind still keeps the nodes it owns.
        rec.node_ids = owned_nodes(project, key)
        rec.ended_at = time.time()

        rec.gate = gate.evaluate(project, rec)
        yield _gate_ev(rec, pid)

        rec.status = (StageStatus.BLOCKED if rec.gate.verdict == "hold"
                      else StageStatus.AWAITING)
        yield _stage_ev(rec, pid)
        yield _ev(type="done", label=_waiting_label(rec), project_id=pid)
        return

    yield _ev(type="done", label=_closing(project), project_id=pid)


def approve_stage(project: Project, key: str, note: str | None = None) -> StageRecord | None:
    """Open a gate. The reviewer's verdict is left exactly as it filed it.

    The only way past a pass, by design — a human is the only thing that opens a gate here.
    """
    rec = project.stage(key)
    if not rec or rec.status not in (StageStatus.AWAITING, StageStatus.BLOCKED):
        return None
    return gate.decide(rec, by="human", approved=True, note=note)


def hold_stage(project: Project, key: str, note: str | None = None) -> StageRecord | None:
    """Refuse a stage the gate was willing to pass — the director's own veto.

    A gate that only ever waits is a speed bump. This is the other direction, and it has to
    exist for the stop to be a decision rather than a formality.
    """
    rec = project.stage(key)
    if not rec or rec.status == StageStatus.PENDING:
        return None
    return gate.decide(rec, by="human", approved=False, note=note)


def resync_stages(project: Project) -> list[StageRecord]:
    """Bring the board back in line with the canvas after a hand edit.

    A note on a character can stale a shot three stages downstream. The gate that approved
    that stage was a verdict about pixels which no longer describe the film, so the stage
    reopens and the next run rebuilds and re-gates it. Leaving it green would be the board
    quietly lying about work that has to happen again.
    """
    reopened = []
    for rec in project.ensure_stages():
        if rec.status != StageStatus.APPROVED:
            continue
        nodes = [n for n in (project.get(i) for i in rec.node_ids) if n]
        if any(n.status in (NodeStatus.STALE, NodeStatus.FAILED) for n in nodes):
            rec.status, rec.gate = StageStatus.PENDING, None
            reopened.append(rec)
    return reopened


# ---- targeted regeneration -------------------------------------------------

def _style_of(project: Project, note: str | None = None) -> str:
    """The film's look, as fixed by the story node — optionally biased by a director's note.

    Read off the graph rather than rebuilt from settings: the story node holds the style the
    existing frames were actually made with, and a re-render has to match those, not a
    preset that may have been changed since.
    """
    n = next((x for x in project.nodes if x.kind == NodeKind.STORY), None)
    style = (n.data.get("style") if n else None) or "cinematic"
    return f"{style}. Director's note: {note}" if note else style


def _scene_context(project: Project, scene_node: Node) -> tuple[dict, list[str], str]:
    """Pull a scene's in-frame character DNA and environment plate back off the graph."""
    dna_blocks, env = [], ""
    for pid in scene_node.parent_ids:
        p = project.get(pid)
        if not p:
            continue
        if p.kind == NodeKind.CHARACTER:
            dna_blocks.append(p.data.get("dna", ""))
        elif p.kind == NodeKind.ENVIRONMENT:
            env = p.data.get("desc", "")
    return _prompt_scene(project, scene_node.data), dna_blocks, env


def _scene_review_context(project: Project, scene_node: Node) -> tuple[list[QCReference], str]:
    """The approved sheets a scene's frames are judged against, plus its cast, off the graph.

    A regenerated frame is reviewed against the same references as the frame it replaces —
    otherwise the gate would be grading each take on a different curve.
    """
    refs, names = [], []
    for pid in scene_node.parent_ids:
        p = project.get(pid)
        if not p:
            continue
        if p.kind == NodeKind.CHARACTER:
            names.append(p.title)
        r = _reference(p)
        if r:
            refs.append(r)
    return refs, ", ".join(names)


def _mark_downstream_stale(project: Project, node: Node) -> Iterator[StageEvent]:
    """An upstream change invalidates everything that inherited from it."""
    for child in entities.mark_stale(project, node.node_id):
        yield _ev(type="node", node=child, project_id=project.project_id)


_VERB = {NodeKind.CHARACTER: "Redesigning", NodeKind.ENVIRONMENT: "Rebuilding",
         NodeKind.KEYFRAME: "Reframing", NodeKind.SHOT: "Re-shooting"}


def _regen(project: Project, node_id: str, note: str | None = None) -> Iterator[StageEvent]:
    """Re-run generation for one node in place, then stale everything downstream of it.

    Every rendered node carries the prompt it was made from, so a re-render is that same
    prompt again — with the director's note folded into it — rather than a fresh guess at
    what the node was supposed to be. Cheap fixes stay cheap: a still re-renders alone, and
    a clip re-animates from its already-approved still.
    """
    pid = project.project_id
    node = project.get(node_id)
    if not node:
        yield _ev(type="error", label="That node is no longer on the canvas.", project_id=pid)
        return
    # A lock is a promise that this exact frame survives every downstream note. Honouring it
    # here covers both a direct regenerate and a scene-level cascade that walks into it.
    if node.locked:
        yield _ev(label=f"{node.title} is locked — leaving it exactly as it is.", project_id=pid)
        return

    if node.kind == NodeKind.SCENE:
        # A scene is a plan, not a render — rebuild the frames and the motion under it.
        for kf in project.children_of(node.node_id):
            if kf.kind != NodeKind.KEYFRAME:
                continue
            yield from _regen(project, kf.node_id, note)
            for shot in project.children_of(kf.node_id):
                if shot.kind == NodeKind.SHOT:
                    yield from _regen(project, shot.node_id, note)
        return

    if node.kind not in RENDERED:
        yield _ev(type="error",
                  label="The story and the final cut are assembled from the graph — "
                        "change a character, scene or shot instead.", project_id=pid)
        return

    yield _ev(label=f"{_VERB[node.kind]} {node.title}…", project_id=pid)
    node.status = NodeStatus.RUNNING
    yield _ev(type="node", node=node, project_id=pid)
    # The note rewrites the stored prompt in place, so the inspector always shows what
    # actually made the frame.
    prompt, base = _repoint(project, node, note), node.attempt + 1

    if node.kind == NodeKind.SHOT:
        kf = _master_of(project, node)
        if not (kf and kf.asset):
            yield _ev(type="error", label="That shot has lost its keyframe.", project_id=pid)
            return
        cov = node.data.get("coverage") or {}
        generate = lambda _a: gb.image_to_video(
            kf.asset.url, prompt, duration=SHOT_SECONDS, aspect_ratio=project.settings.aspect,
            framing=cov.get("shot"), move=cov.get("move"))
        budget = cfg.QC_MAX_VIDEO_REGENS
    else:
        seed = node.data.get("id") or f"{node.data.get('n','')}-{node.data.get('i','')}"
        generate = lambda a: gb.generate_image(prompt, seed=f"{seed}-{base + a}",
                                               aspect_ratio=project.settings.aspect)
        budget = cfg.QC_MAX_REGENS

    asset, report, attempt = yield from _gated(
        node, node.kind, generate, _target_for(project, node, note), budget, pid)
    _settle(node, asset, report, base + attempt, note=note)
    yield _ev(type="node", node=node, project_id=pid)
    yield from _mark_downstream_stale(project, node)


def regenerate_node(project: Project, node_id: str, note: str | None = None) -> Iterator[StageEvent]:
    """Public entry point — one regeneration, one closing event.

    Whatever this invalidated downstream reopens its stage on the way out, so the board and
    the canvas never disagree about how much of the film still stands.
    """
    node = project.get(node_id)
    yield from _regen(project, node_id, note)
    for rec in resync_stages(project):
        yield _stage_ev(rec, project.project_id)
    yield _ev(type="done", label=f"{node.title} is back." if node else "Nothing to regenerate.",
              project_id=project.project_id)


def add_shot(project: Project, keyframe_id: str, spec: dict) -> Iterator[StageEvent]:
    """Shoot one more setup on a scene — a new generation unit, framed off the same sheets.

    This is the canvas equivalent of calling for another angle. A unit is a still and the
    clip animated from it, so this costs one image and one animation and nothing else — no
    story rewrite, no re-rendered sheets, no downstream staling.

    `spec` carries whatever the director asked for (shot type, angle, move, and a free note);
    anything left blank falls back to the scene's own staging. `keyframe_id` names any frame
    of the scene — the new unit joins that scene, it is not filmed off that one frame.
    """
    pid = project.project_id
    kf = project.get(keyframe_id)
    if not kf or kf.kind != NodeKind.KEYFRAME:
        yield _ev(type="error", label="Shots are framed off an existing frame — pick one first.",
                  project_id=pid)
        return
    scene_node = _scene_of(project, kf)
    if not scene_node:
        yield _ev(type="error", label="That keyframe has lost its scene.", project_id=pid)
        return

    scene, dna_blocks, env = _scene_context(project, scene_node)
    style = _style_of(project)
    unit = {
        "shot": (spec.get("shot") or "").strip() or scene.get("shot", "medium shot"),
        "angle": (spec.get("angle") or "").strip() or scene.get("angle", "eye level"),
        "move": (spec.get("move") or "").strip() or scene.get("move", "locked camera"),
        "action": (spec.get("note") or "").strip() or scene.get("action", ""),
        "intent": (spec.get("note") or "").strip(),
    }
    # Written the same way synthesis writes them, so an added unit is indistinguishable from
    # a planned one everywhere downstream — same fields, same prompts, same gate.
    unit["keyframe_prompt"] = camera.keyframe_prompt(style, scene, dna_blocks, env, unit)
    unit["video_prompt"] = camera.video_prompt(style, scene, dna_blocks, env, unit)
    setup = f"{unit['shot']}, {unit['angle']}"

    # The unit is appended to the scene's own coverage: the plan is what the stages walk, so
    # a unit that only existed as nodes would vanish the next time a pass was re-entered.
    coverage_list = scene_node.data.setdefault("coverage", [])
    i = len(coverage_list)
    coverage_list.append(entities.tokenize_deep(unit, project.entity_names()))
    stored = coverage_list[i]
    n = scene.get("n", "")

    yield _ev(label=f"Shooting another setup on scene {n} — {setup}…", project_id=pid)
    yield _ev(type="node", node=scene_node, project_id=pid)

    kf_new = project.add(Node(
        kind=NodeKind.KEYFRAME, title=f"Frame {n}.{i + 1}", status=NodeStatus.RUNNING,
        parent_ids=[scene_node.node_id],
        data={"n": n, "i": i, "scene_title": scene.get("title", ""), "setup": setup,
              "coverage": stored, "prompt": stored["keyframe_prompt"], "added": True}))
    yield _ev(type="node", node=kf_new, project_id=pid)
    with _safe(kf_new, "keyframe"):
        prompt = _prompt_of(project, kf_new)
        asset, report, attempt = yield from _gated(
            kf_new, NodeKind.KEYFRAME,
            lambda a: gb.generate_image(prompt, seed=f"{n}-{i}-{a}",
                                        aspect_ratio=project.settings.aspect),
            _target_for(project, kf_new), cfg.QC_MAX_REGENS, pid)
        _settle(kf_new, asset, report, attempt)
    yield _ev(type="node", node=kf_new, project_id=pid)

    if not kf_new.asset:
        yield _ev(type="done", project_id=pid,
                  label=f"The frame for that setup didn't render, so there was nothing to "
                        f"animate. Regenerate {kf_new.title} to try again.")
        return

    shot = project.add(Node(
        kind=NodeKind.SHOT, title=f"Shot {n}.{i + 1}", status=NodeStatus.RUNNING,
        parent_ids=[kf_new.node_id],
        data={"vo": "", "n": n, "i": i, "setup": setup, "coverage": stored,
              "prompt": stored["video_prompt"], "added": True}))
    yield _ev(type="node", node=shot, project_id=pid)
    with _safe(shot, "animation"):
        prompt = _prompt_of(project, shot)
        asset, report, attempt = yield from _gated(
            shot, NodeKind.SHOT,
            lambda _a: gb.image_to_video(kf_new.asset.url, prompt, duration=SHOT_SECONDS,
                                         aspect_ratio=project.settings.aspect,
                                         framing=unit.get("shot"), move=unit.get("move")),
            _target_for(project, shot), cfg.QC_MAX_VIDEO_REGENS, pid)
        _settle(shot, asset, report, attempt)
    yield _ev(type="node", node=shot, project_id=pid)
    yield from _assemble(project)
    yield _ev(type="done", project_id=pid,
              label=f"{shot.title} is in — {setup}. The sheets and the rest of the scene were "
                    f"reused, so nothing else in the film changed.")


def suggest_setup(project: Project, keyframe_id: str) -> dict | None:
    """What to shoot next on this scene, and why.

    Reads the scene off the graph together with every setup already covered, so the
    recommendation is the shot that is *missing* rather than one more of what we have. Costs
    a text call and renders nothing — it fills the form in, and the director still decides
    whether to take it.
    """
    kf = project.get(keyframe_id)
    if not kf or kf.kind != NodeKind.KEYFRAME:
        return None
    scene_node = _scene_of(project, kf)
    if not scene_node:
        return None

    scene, _dna, env = _scene_context(project, scene_node)
    _refs, cast = _scene_review_context(project, scene_node)
    existing = [c.data.get("coverage") or {} for c in project.children_of(scene_node.node_id)
                if c.kind == NodeKind.KEYFRAME]
    out = coverage.suggest(scene, _style_of(project), existing, cast=cast, env=env)
    out["covered"] = len(existing)
    return out


def review_node(project: Project, node_id: str):
    """Re-review a node's accepted take. Nothing is re-rendered.

    Reviewing is the cheap half of the gate — it re-reads pixels that already exist — so a
    second opinion costs a text call, not another render. The verdict lands on the take as
    well as the node, because the take is what it is a verdict about.

    Returns (node, report), or (node, None) when there is nothing to look at.
    """
    node = project.get(node_id)
    if not node or not node.asset:
        return node, None

    report = qc_agent.review(node.kind, node.asset, _target_for(project, node))
    node.qc = report
    v = next((x for x in node.versions if x.version == node.accepted_version), None)
    if v:
        v.qc = report
    # Only the gate's own two states are the gate's to set: a stale or failed node stays
    # stale or failed no matter how good the pixels it is still showing happen to look.
    if node.status in (NodeStatus.READY, NodeStatus.FLAGGED):
        node.status = NodeStatus.READY if qc_agent.accepted(report) else NodeStatus.FLAGGED
    return node, report


def run_edit(project: Project, instruction: str, target_node_id: str | None) -> Iterator[StageEvent]:
    """Conversational edit: work out what the note meant, then change only what it touched.

    An explicit selection on the canvas always wins; otherwise the intent router reads the
    note against the graph. Renames are settled through the token layer — instant, and
    without re-rendering a single frame — while anything semantic goes through the normal
    regeneration path.
    """
    pid = project.project_id
    names = project.entity_names()
    change, new_name = "semantic", None

    if target_node_id:
        target = project.get(target_node_id)
        # An addressed note still gets its change classified: naming the node it applies to
        # says nothing about whether it is a rename, and a rename must stay free.
        new_name = route.rename_intent(instruction)
        if new_name:
            change = "rename"
    else:
        node_id, change, new_name = route.route(project, instruction)
        target = project.get(node_id) if node_id else None

    if not target:
        yield _ev(type="error", project_id=pid,
                  label="I couldn't tell which part of the film you meant — name a "
                        "character, a place, or a scene and I'll take it from there.")
        return

    # Rename: pure graph edit. Everything that mentions the entity re-resolves for free.
    if change == "rename" and new_name and target.data.get("id"):
        old = target.title
        yield _ev(label=f"Renaming {old} to {new_name} everywhere…", project_id=pid)
        for n in entities.rename_entity(project, target.data["id"], new_name):
            yield _ev(type="node", node=n, project_id=pid)
        yield _ev(type="done", project_id=pid,
                  label=f"{old} is now {new_name} — across the story, every scene and the "
                        f"voiceover. No frames needed re-rendering.")
        return

    yield _ev(label=f"Applying your note to {entities.resolve(target.title, names)}: "
                    f"“{instruction}”…", project_id=pid)
    yield from regenerate_node(project, target.node_id, note=instruction)


# ---- propose → approve -----------------------------------------------------
#
# The composer no longer applies a note the instant it is typed. It proposes: it works out
# what the note would change, shows the director the field diff and what it would re-render,
# and waits. Nothing is written and nothing is paid for until the director approves — which
# is the whole reason the edit surface is a working surface rather than a fire button.

# The one descriptive field each kind keeps in the story bible — the thing a note like
# "make the agbada white" is actually about. Keyframes and shots have no bible text of their
# own; a note about one of those steers its prompt directly instead.
_EDITABLE = {
    NodeKind.CHARACTER: ("dna", "wardrobe & look"),
    NodeKind.ENVIRONMENT: ("desc", "location"),
    NodeKind.SCENE: ("action", "staging"),
}


def _descendants_of(project: Project, node: Node) -> list[Node]:
    """Everything downstream of a node, breadth-first. The blast radius of changing it."""
    out, seen, queue = [], {node.node_id}, list(project.children_of(node.node_id))
    while queue:
        n = queue.pop(0)
        if n.node_id in seen:
            continue
        seen.add(n.node_id)
        out.append(n)
        queue.extend(project.children_of(n.node_id))
    return out


def _rendered_under(project: Project, node: Node) -> list[Node]:
    """The node and its descendants that exist as pixels somebody paid for.

    This is the difference between "re-render three shots" and "change some text nothing has
    been built from yet". An edit to a character the sheets pass has not reached is free; the
    same edit an hour later is not, and the director should be told which one they are making.
    """
    return [n for n in ([node] + _descendants_of(project, node)) if n.asset]


def _rewrite_field(style: str, label: str, current: str, instruction: str) -> str | None:
    """Rewrite one bible field to satisfy a note — the whole revised value, not a diff.

    Returns None when there is no text model, which is the keyless demo: the edit still
    happens, it just travels as a note folded into the prompt rather than as a visible
    before/after on the bible text. Both are honest; only one shows a diff.
    """
    if cfg.mock_text():
        return None
    system = ("You revise ONE field of a film's story bible to satisfy a director's note. "
              "Return STRICT JSON: {\"value\": \"<the full revised field>\"}. Keep the "
              "field's own register and roughly its length — you are editing it, not "
              "rewriting the film. Change only what the note asks for.")
    import json
    user = json.dumps({"field": label, "current": current, "note": instruction,
                       "film_style": style})
    try:
        raw = gb.chat(system, user, json_mode=True, temperature=0.3)
        val = json.loads(re.search(r"\{.*\}", raw, re.DOTALL).group(0)).get("value")
        val = (val or "").strip()
        return val or None
    except Exception:
        return None


def _edit_impact(project: Project, node: Node, change: str, new_name: str | None) -> dict:
    """What approving this proposal would actually cost, counted off real pixels.

    Unlike the inspector's by-kind impact, this counts a descendant as needing a re-render
    only if it has actually been rendered — so a note on a not-yet-designed character reads
    "text only", not "3 assets", which would be three assets that do not exist.
    """
    names = project.entity_names()
    if change == "rename" and node.data.get("id"):
        rewritten = [
            {"node_id": r.node_id, "title": entities.resolve(r.node_title, names),
             "kind": r.node_kind, "field": r.field}
            for r in entities.back_references(project).get(node.data["id"], [])
        ]
        return {"stale": [], "rewritten": rewritten,
                "cost_hint": "Renames everywhere it's mentioned — no frames re-render, "
                             "nothing is re-paid for."}

    rendered = _rendered_under(project, node)
    stale = [{"node_id": n.node_id, "title": entities.resolve(n.title, names),
              "kind": n.kind.value} for n in rendered]
    if stale:
        cost = (f"{len(stale)} rendered asset{'s' if len(stale) != 1 else ''} re-render, "
                f"everything else stays as it is.")
    else:
        cost = "Text only — nothing here has been rendered yet, so nothing is re-paid for."
    return {"stale": stale, "rewritten": [], "cost_hint": cost}


def propose_edit(project: Project, instruction: str, target_node_id: str | None) -> dict:
    """Read a note against the graph and describe the change — without making it.

    Returns a proposal the composer shows above the input: the target, the kind of change,
    the field diff where there is one, and the cost. Approving it calls `apply_edit`; nothing
    here writes to the graph or spends a render.
    """
    names = project.entity_names()
    change, new_name = "semantic", None

    if target_node_id:
        target = project.get(target_node_id)
        new_name = route.rename_intent(instruction)
        if new_name:
            change = "rename"
    else:
        node_id, change, new_name = route.route(project, instruction)
        target = project.get(node_id) if node_id else None

    if not target or target.kind in (NodeKind.STORY, NodeKind.TIMELINE):
        return {"ok": False,
                "reason": "I couldn't tell which part of the film you meant — name a "
                          "character, a place, a scene or a shot, or @-reference one."}

    title = entities.resolve(target.title, names)
    tgt = {"node_id": target.node_id, "title": title, "kind": target.kind.value}
    rendered = bool(_rendered_under(project, target))

    # A rename is unambiguous and free — no field diff, no render, just the propagation.
    if change == "rename" and new_name and target.data.get("id"):
        return {"ok": True, "target": tgt, "change": "rename", "new_name": new_name,
                "from": title, "to": new_name, "field": "name", "label": "name",
                "note": instruction, "rendered": rendered,
                "impact": _edit_impact(project, target, "rename", new_name),
                "summary": f"Rename {title} to “{new_name}” everywhere."}

    # A note about a keyframe or a shot steers its prompt; everything else has a bible field
    # the note is really about, so we try to show the edit as a before/after on that field.
    field_spec = _EDITABLE.get(target.kind)
    if field_spec:
        field, label = field_spec
        current = entities.resolve(target.data.get(field, ""), names)
        proposed = _rewrite_field(_style_of(project), label, current, instruction)
        if proposed and proposed != current:
            return {"ok": True, "target": tgt, "change": "field", "field": field,
                    "label": label, "from": current, "to": proposed,
                    "note": instruction, "rendered": rendered,
                    "impact": _edit_impact(project, target, "field", None),
                    "summary": f"Change {title}'s {label}."}

    # No model, or nothing to diff: carry the note into the prompt as-is.
    return {"ok": True, "target": tgt, "change": "note", "field": None, "label": None,
            "from": None, "to": None, "note": instruction, "rendered": rendered,
            "impact": _edit_impact(project, target, "note", None),
            "summary": f"Apply your note to {title}."}


def _steer_future(project: Project, node: Node, note: str) -> Iterator[StageEvent]:
    """Fold a note into a not-yet-rendered node's stored prompt(s), spending nothing.

    The rendered path re-renders; this is its opposite number — the edit lands on the prompt
    the future render will read, so a change made before a stage runs is honoured when it
    does, without paying to render it twice.
    """
    if node.kind in (NodeKind.CHARACTER, NodeKind.ENVIRONMENT):
        node.data["prompt"] = camera.with_note(node.data.get("prompt") or "", note)
    elif node.kind == NodeKind.SCENE:
        # A scene has no prompt of its own; its units carry the prompts the passes will send.
        for unit in node.data.get("coverage") or []:
            unit["keyframe_prompt"] = camera.with_note(unit.get("keyframe_prompt") or "", note)
            unit["video_prompt"] = camera.with_note(unit.get("video_prompt") or "", note)
    yield from ()


def apply_edit(project: Project, req) -> Iterator[StageEvent]:
    """Execute an approved proposal. This is the only half of the edit that writes.

    Two paths, decided by whether anything has actually been rendered under the target:
      * rendered  → change the bible text, then regenerate the node and everything connected
                    to it, exactly as a note-driven regenerate would.
      * not yet   → change the bible text and steer the stored prompt, but spend nothing —
                    the pass that eventually renders it reads the edit off the graph.

    A rename is neither: it re-resolves text everywhere and never touches a frame.
    """
    pid = project.project_id
    node = project.get(req.target_node_id)
    if not node:
        yield _ev(type="error", label="That part of the film is no longer on the canvas.",
                  project_id=pid)
        return

    names = project.entity_names()

    if req.change == "rename" and req.new_name and node.data.get("id"):
        old = entities.resolve(node.title, names)
        yield _ev(label=f"Renaming {old} to {req.new_name} everywhere…", project_id=pid)
        for n in entities.rename_entity(project, node.data["id"], req.new_name):
            yield _ev(type="node", node=n, project_id=pid)
        yield _ev(type="done", project_id=pid,
                  label=f"{old} is now {req.new_name} — across the story, every scene and "
                        f"the voiceover. No frames needed re-rendering.")
        return

    # A field edit updates the bible text the inspector and the story brief read from. Stored
    # tokenised like every other piece of prose, so a name inside it still renames for free.
    if req.change == "field" and req.field and req.to is not None:
        node.data[req.field] = entities.tokenize(req.to, names)
        yield _ev(type="node", node=node, project_id=pid)

    note = req.note or None

    if _rendered_under(project, node):
        # Something downstream exists — carry the change through it.
        yield from regenerate_node(project, node.node_id, note=note)
        return

    # Nothing rendered yet: the edit is real but free. Steer the future render and stop.
    if note:
        yield from _steer_future(project, node, note)
    for rec in resync_stages(project):
        yield _stage_ev(rec, pid)
    title = entities.resolve(node.title, names)
    yield _ev(type="done", project_id=pid,
              label=f"{title} updated. Nothing was rendered yet, so it costs nothing now — "
                    f"the change is baked in for when that pass runs.")
