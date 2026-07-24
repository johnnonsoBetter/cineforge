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
        res = gb.tts(line)
    except Exception:
        return
    if res.url and not res.url.startswith("mock://"):
        shot.data["vo_url"] = res.url
        shot.data["vo_provenance"] = res.provenance.model_dump()
    yield from ()


# ---- the stages ------------------------------------------------------------
#
# The film is not built in one sweep. It is built in passes, each of which is a thing a
# director would want to look at before paying for the next one: the story, then the cast,
# then the locations, then the breakdown, then the frames, then the motion, then the cut.
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


def _scene_node_for(project: Project, n: object) -> Node | None:
    return next((s for s in project.by_kind(NodeKind.SCENE) if s.data.get("n") == n), None)


def _keyframe_of(project: Project, scene_node: Node) -> Node | None:
    return next((c for c in project.children_of(scene_node.node_id)
                 if c.kind == NodeKind.KEYFRAME), None)


def stage_story(project: Project) -> Iterator[StageEvent]:
    """Write the film: logline, bible, beats, cast, locations, scene breakdown."""
    pid = project.project_id
    if _story_node(project):
        return   # the film is already written; re-entering this stage must not rewrite it

    yield _ev(label="Understanding the story…", project_id=pid)
    yield _progress("story", 0, 1, pid)
    cfgp = project.settings
    plan = entities.tokenize_plan(story_agent.plan(project.idea, cfgp))
    project.title = plan.get("title", project.title)
    project.story_source = plan.get("_source", "sample")
    # The chosen preset leads; whatever the story agent wrote follows it.
    style = story_agent.style_block(cfgp.style_preset, plan.get("style", ""))

    node = project.add(Node(kind=NodeKind.STORY, title=project.title,
                            status=NodeStatus.READY,
                            data={"style": style, "logline": project.idea,
                                  "source": project.story_source,
                                  "bible": plan.get("bible", {}),
                                  "beats": plan.get("beats", []),
                                  "plan": plan}))
    yield _ev(type="node", node=node, project_id=pid)
    yield _progress("story", 1, 1, pid)


def stage_characters(project: Project) -> Iterator[StageEvent]:
    """The founding reference sheets — gated hardest, because everything inherits them.

    A wrong sheet is not one bad frame; it is a whole film of the wrong person. This is the
    stage most worth stopping after.
    """
    pid = project.project_id
    story = _story_node(project)
    if not story:
        return
    style, aspect = _style_of(project), project.settings.aspect
    cast = _plan(project).get("characters", [])
    todo = [c for c in cast if not project.entity_node(c["id"])]
    if not todo:
        return

    yield _ev(label="Designing the characters…", project_id=pid)
    done = len(cast) - len(todo)
    yield _progress("characters", done, len(cast), pid)
    for c in todo:
        n = project.add(Node(kind=NodeKind.CHARACTER, title=c["name"],
                             status=NodeStatus.RUNNING, parent_ids=[story.node_id],
                             data={"id": c["id"], "dna": c.get("dna", "")}))
        yield _ev(type="node", node=n, project_id=pid)
        with _safe(n, "character sheet"):
            asset, report, attempt = yield from _gated(
                n, NodeKind.CHARACTER,
                lambda a: gb.generate_image(_char_prompt(style, c.get("dna", "")),
                                            seed=f"{c['id']}-{a}", aspect_ratio=aspect),
                _target_for(project, n), cfg.QC_MAX_REGENS, pid)
            _settle(n, asset, report, attempt)
        done += 1
        yield _ev(type="node", node=n, project_id=pid)
        yield _progress("characters", done, len(cast), pid)


def stage_environments(project: Project) -> Iterator[StageEvent]:
    """The establishing plates every scene is staged inside."""
    pid = project.project_id
    story = _story_node(project)
    if not story:
        return
    style, aspect = _style_of(project), project.settings.aspect
    places = _plan(project).get("environments", [])
    todo = [e for e in places if not project.entity_node(e["id"])]
    if not todo:
        return

    yield _ev(label="Creating the locations…", project_id=pid)
    done = len(places) - len(todo)
    yield _progress("environments", done, len(places), pid)
    for e in todo:
        desc = e.get("desc", e.get("name", ""))
        n = project.add(Node(kind=NodeKind.ENVIRONMENT, title=e["name"],
                             status=NodeStatus.RUNNING, parent_ids=[story.node_id],
                             data={"id": e["id"], "desc": desc}))
        yield _ev(type="node", node=n, project_id=pid)
        with _safe(n, "environment plate"):
            asset, report, attempt = yield from _gated(
                n, NodeKind.ENVIRONMENT,
                lambda a: gb.generate_image(_env_prompt(style, desc),
                                            seed=f"{e['id']}-{a}", aspect_ratio=aspect),
                _target_for(project, n), cfg.QC_MAX_REGENS, pid)
            _settle(n, asset, report, attempt)
        done += 1
        yield _ev(type="node", node=n, project_id=pid)
        yield _progress("environments", done, len(places), pid)


def stage_scenes(project: Project) -> Iterator[StageEvent]:
    """Hang the breakdown off the cast and locations it was written for.

    The cheapest stage and the most valuable gate: this is the last point where changing
    your mind costs a text call rather than a render.
    """
    pid = project.project_id
    story = _story_node(project)
    if not story:
        return
    scenes = _plan(project).get("scenes", [])
    if not scenes:
        return

    done = sum(1 for s in scenes if _scene_node_for(project, s["n"]))
    yield _progress("scenes", done, len(scenes), pid)
    for scene in scenes:
        if _scene_node_for(project, scene["n"]):
            continue
        yield _ev(label=f"Building scene {scene['n']}: {scene.get('title','')}…", project_id=pid)
        parents = [story.node_id]
        for cid in scene.get("character_ids", []):
            c = project.entity_node(cid)
            if c:
                parents.append(c.node_id)
        env = project.entity_node(scene.get("environment_id"))
        if env:
            parents.append(env.node_id)

        node = project.add(Node(
            kind=NodeKind.SCENE, title=f"Scene {scene['n']}: {scene.get('title','')}",
            status=NodeStatus.READY, parent_ids=parents, data=scene))
        done += 1
        yield _ev(type="node", node=node, project_id=pid)
        yield _progress("scenes", done, len(scenes), pid)


def stage_keyframes(project: Project) -> Iterator[StageEvent]:
    """One master frame per scene. Everything the scene is covered with is animated from it,
    which is why a bad master is a bad scene however many angles you shoot it from."""
    pid = project.project_id
    aspect = project.settings.aspect
    scene_nodes = project.by_kind(NodeKind.SCENE)
    if not scene_nodes:
        return

    done = sum(1 for s in scene_nodes if _keyframe_of(project, s))
    yield _progress("keyframes", done, len(scene_nodes), pid)
    for scene_node in scene_nodes:
        if _keyframe_of(project, scene_node):
            continue
        style = _style_of(project)
        scene, dna_blocks, env = _scene_context(project, scene_node)
        n = scene.get("n", "")
        yield _ev(label=f"Framing scene {n}…", project_id=pid)
        kf = project.add(Node(
            kind=NodeKind.KEYFRAME, title=f"Keyframe · Scene {n}",
            status=NodeStatus.RUNNING, parent_ids=[scene_node.node_id],
            data={"n": n, "scene_title": scene.get("title", ""),
                  "action": scene.get("action", "")}))
        with _safe(kf, "keyframe"):
            asset, report, attempt = yield from _gated(
                kf, NodeKind.KEYFRAME,
                lambda a: gb.generate_image(
                    camera.keyframe_prompt(style, scene, dna_blocks, env),
                    seed=f"{n}-{a}", aspect_ratio=aspect),
                _target_for(project, kf), cfg.QC_MAX_REGENS, pid)
            _settle(kf, asset, report, attempt)
        done += 1
        yield _ev(type="node", node=kf, project_id=pid)
        yield _progress("keyframes", done, len(scene_nodes), pid)


def stage_shots(project: Project) -> Iterator[StageEvent]:
    """The coverage: every camera setup, animated off its already-approved master frame.

    The expensive stage, and the reason the gates before it exist at all.
    """
    pid = project.project_id
    aspect = project.settings.aspect
    plans: list[tuple[Node, Node, dict, list[str], str, list[dict]]] = []
    for scene_node in project.by_kind(NodeKind.SCENE):
        kf = _keyframe_of(project, scene_node)
        if not kf:
            continue
        scene, dna_blocks, env = _scene_context(project, scene_node)
        plans.append((scene_node, kf, scene, dna_blocks, env, scene.get("coverage") or []))

    total = sum(len(cov) for *_, cov in plans)
    if not total:
        return
    existing = {(s.data.get("n"), s.data.get("i")) for s in project.by_kind(NodeKind.SHOT)}
    done = 0
    yield _progress("shots", len(existing), total, pid)

    for _scene_node, kf, scene, dna_blocks, env, coverage in plans:
        n = scene.get("n", "")
        style = _style_of(project)
        for ci, cov in enumerate(coverage):
            done += 1
            if (n, ci) in existing:
                continue
            if not kf.asset:
                # No master frame to shoot from — tick anyway so the bar still reaches its
                # total instead of stalling on a scene that already failed.
                yield _progress("shots", done, total, pid)
                continue

            setup = f"{cov.get('shot','')}, {cov.get('angle','')}".strip(", ")
            yield _ev(label=f"Shooting scene {n} — {setup}…", project_id=pid)
            shot_node = project.add(Node(
                kind=NodeKind.SHOT,
                title=f"Shot {n}" + (f".{ci + 1}" if len(coverage) > 1 else ""),
                status=NodeStatus.RUNNING,
                parent_ids=[kf.node_id],
                # The setup lives on the node: it is what a re-render has to reproduce, and
                # what the inspector shows as this shot's reason for existing.
                data={"vo": scene.get("vo", ""), "n": n, "i": ci,
                      "setup": setup, "coverage": cov}))
            with _safe(shot_node, "animation"):
                sp = camera.shot_prompt(style, scene, dna_blocks, env, coverage=cov)
                # Judged against the master it was framed from, on stills sampled across
                # the whole clip — that's how a face that morphs at second four is caught.
                asset, report, attempt = yield from _gated(
                    shot_node, NodeKind.SHOT,
                    lambda _a: gb.image_to_video(kf.asset.url, sp, duration=SHOT_SECONDS,
                                                 aspect_ratio=aspect,
                                                 framing=cov.get("shot"), move=cov.get("move")),
                    _target_for(project, shot_node), cfg.QC_MAX_VIDEO_REGENS, pid)
                _settle(shot_node, asset, report, attempt)
                # One voiceover per scene, on its first shot — repeating the line on every
                # setup would stammer it.
                if ci == 0:
                    yield from _add_vo(project, shot_node, scene.get("vo", ""))
            yield _ev(type="node", node=shot_node, project_id=pid)
            yield _progress("shots", done, total, pid)


def stage_assembly(project: Project) -> Iterator[StageEvent]:
    """The cut — every shot that survived its gate, in scene order."""
    pid = project.project_id
    shots = sorted(project.by_kind(NodeKind.SHOT),
                   key=lambda s: (s.data.get("n") or 0, s.data.get("i") or 0))
    if not shots:
        return

    yield _ev(label="Assembling the film…", project_id=pid)
    yield _progress("assembly", 0, 1, pid)
    ids = [s.node_id for s in shots]
    timeline = next((n for n in project.by_kind(NodeKind.TIMELINE)), None)
    if timeline:
        # Re-entering assembly after a note re-cuts the same timeline rather than leaving a
        # second Final Film on the canvas.
        timeline.parent_ids, timeline.data["shots"] = ids, ids
        timeline.status = NodeStatus.READY
    else:
        timeline = project.add(Node(kind=NodeKind.TIMELINE, title="Final Film",
                                    status=NodeStatus.READY, parent_ids=ids,
                                    data={"shots": ids}))
    yield _ev(type="node", node=timeline, project_id=pid)
    yield _progress("assembly", 1, 1, pid)


STAGES = {
    "story": stage_story,
    "characters": stage_characters,
    "environments": stage_environments,
    "scenes": stage_scenes,
    "keyframes": stage_keyframes,
    "shots": stage_shots,
    "assembly": stage_assembly,
}


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


def _refresh_stale(project: Project, rec: StageRecord) -> Iterator[StageEvent]:
    """Rebuild whatever in this stage an upstream change invalidated.

    A stage builds what is missing; this is the other half — what is present but no longer
    true. Without it, re-running a reopened stage would sail past its own stale nodes and
    re-gate a pass it never actually redid.

    Reaching a stage at all means every stage above it has cleared its gate, so a node that
    was only stale by inheritance is current again by the time we are standing here. That is
    why a scene comes back for free and a keyframe has to be paid for.
    """
    for nid in list(rec.node_ids):
        n = project.get(nid)
        if not n or n.status != NodeStatus.STALE or n.locked:
            continue
        if n.kind in RENDERED:
            yield from _regen(project, nid)
        else:
            n.status = NodeStatus.READY
            yield _ev(type="node", node=n, project_id=project.project_id)


def run(project: Project, *, stop_after: str | None = None,
        gate_mode: GateMode | None = None) -> Iterator[StageEvent]:
    """Run the film stage by stage, stopping wherever the gate says to stop.

    Stages already approved are skipped, so this is both "start the film" and "continue from
    where the director left it" — the difference is only how much of the board is already
    green. On an auto gate with nothing outstanding the run flows straight through and looks
    exactly like one continuous generation; the moment something needs a human it stops
    *before* spending the next stage's budget, which is the entire point.
    """
    pid = project.project_id
    project.ensure_stages()
    if gate_mode:
        project.gate_mode = gate_mode
    mode = project.gate_mode

    for key in models.STAGE_KEYS:
        rec = project.stage(key)
        if rec.status == StageStatus.APPROVED:
            continue

        rec.status = StageStatus.RUNNING
        rec.started_at = rec.started_at or time.time()
        yield _stage_ev(rec, pid)

        before = {n.node_id for n in project.nodes}
        yield from _refresh_stale(project, rec)
        yield from STAGES[key](project)
        # What this stage is answerable for. Read off the graph rather than tracked through
        # the yields, so a stage that only repaired what an earlier pass left behind still
        # keeps the nodes it owns.
        produced = [n.node_id for n in project.nodes if n.node_id not in before]
        rec.node_ids = produced or rec.node_ids
        rec.ended_at = time.time()

        rec.gate = gate.evaluate(project, rec, mode)
        yield _gate_ev(rec, pid)

        if gate.opens_itself(rec.gate):
            gate.decide(rec, by="ai", approved=True)
            yield _stage_ev(rec, pid)
            # Re-rendering inside this stage can have staled a stage further down that had
            # already cleared. Reopening it now is what stops the run walking past work it
            # has just created for itself.
            for reopened in resync_stages(project):
                yield _stage_ev(reopened, pid)
            if stop_after == key:
                yield _ev(type="done", project_id=pid,
                          label=f"{rec.label} done — stopping here as asked.")
                return
            continue

        rec.status = (StageStatus.BLOCKED if rec.gate.verdict == "hold"
                      else StageStatus.AWAITING)
        yield _stage_ev(rec, pid)
        yield _ev(type="done", label=_waiting_label(rec), project_id=pid)
        return

    yield _ev(type="done", label=_closing(project), project_id=pid)


def approve_stage(project: Project, key: str, note: str | None = None) -> StageRecord | None:
    """Open a gate by hand. The reviewer's verdict is left exactly as it filed it."""
    rec = project.stage(key)
    if not rec or rec.status not in (StageStatus.AWAITING, StageStatus.BLOCKED):
        return None
    return gate.decide(rec, by="human", approved=True, note=note)


def hold_stage(project: Project, key: str, note: str | None = None) -> StageRecord | None:
    """Refuse a stage the gate was willing to pass — the director's own veto.

    Approving early stages is how a run goes fast; this is the other direction, and it has
    to exist for the gate to be a decision rather than a formality.
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


def _regen(project: Project, node_id: str, note: str | None = None) -> Iterator[StageEvent]:
    """Re-run generation for one node in place, then stale everything downstream of it.

    Cheap fixes stay cheap: a keyframe re-runs the QC gate at the still, and a shot
    re-animates from its already-approved keyframe rather than regenerating the frame.
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

    style = _style_of(project, note)

    if node.kind in (NodeKind.CHARACTER, NodeKind.ENVIRONMENT):
        is_char = node.kind == NodeKind.CHARACTER
        yield _ev(label=f"Redesigning {node.title}…", project_id=pid)
        node.status = NodeStatus.RUNNING
        yield _ev(type="node", node=node, project_id=pid)
        base = node.attempt + 1
        prompt = (_char_prompt(style, node.data.get("dna", "")) if is_char
                  else _env_prompt(style, node.data.get("desc", "")))
        seed_base = node.data.get("id", node.node_id)
        asset, report, attempt = yield from _gated(
            node, node.kind,
            lambda a: gb.generate_image(prompt, seed=f"{seed_base}-{base + a}",
                                        aspect_ratio=project.settings.aspect),
            _target_for(project, node, note), cfg.QC_MAX_REGENS, pid)
        _settle(node, asset, report, base + attempt, note=note)
        yield _ev(type="node", node=node, project_id=pid)
        yield from _mark_downstream_stale(project, node)

    elif node.kind == NodeKind.KEYFRAME:
        scene_node = next((project.get(p) for p in node.parent_ids
                           if project.get(p) and project.get(p).kind == NodeKind.SCENE), None)
        if not scene_node:
            yield _ev(type="error", label="That keyframe has lost its scene.", project_id=pid)
            return
        yield _ev(label=f"Reframing {node.title}…", project_id=pid)
        node.status = NodeStatus.RUNNING
        yield _ev(type="node", node=node, project_id=pid)
        scene, dna_blocks, env = _scene_context(project, scene_node)
        base = node.attempt + 1
        asset, report, attempt = yield from _gated(
            node, NodeKind.KEYFRAME,
            lambda a: gb.generate_image(
                camera.keyframe_prompt(style, scene, dna_blocks, env),
                seed=f"{scene['n']}-{base + a}", aspect_ratio=project.settings.aspect),
            _target_for(project, node, note), cfg.QC_MAX_REGENS, pid)
        _settle(node, asset, report, base + attempt, note=note)
        yield _ev(type="node", node=node, project_id=pid)
        yield from _mark_downstream_stale(project, node)

    elif node.kind == NodeKind.SHOT:
        kf = _master_of(project, node)
        scene_node = _scene_of(project, kf) if kf else None
        if not (kf and kf.asset and scene_node):
            yield _ev(type="error", label="That shot has lost its keyframe.", project_id=pid)
            return
        yield _ev(label=f"Re-shooting {node.title}…", project_id=pid)
        node.status = NodeStatus.RUNNING
        yield _ev(type="node", node=node, project_id=pid)
        scene, dna_blocks, env = _scene_context(project, scene_node)
        # The setup is the shot's own, read off the node: a re-render is the same camera
        # on the same master, not a fresh guess at how the scene should be covered.
        cov = node.data.get("coverage") or {}
        sp = camera.shot_prompt(style, scene, dna_blocks, env, coverage=cov)
        base = node.attempt + 1
        asset, report, attempt = yield from _gated(
            node, NodeKind.SHOT,
            lambda _a: gb.image_to_video(kf.asset.url, sp, duration=SHOT_SECONDS,
                                         aspect_ratio=project.settings.aspect,
                                         framing=cov.get("shot"), move=cov.get("move")),
            _target_for(project, node, note), cfg.QC_MAX_VIDEO_REGENS, pid)
        _settle(node, asset, report, base + attempt, note=note)
        yield _ev(type="node", node=node, project_id=pid)
        yield from _mark_downstream_stale(project, node)

    elif node.kind == NodeKind.SCENE:
        # A scene is a plan, not a render — rebuild the frame and the motion under it.
        for child in project.children_of(node.node_id):
            if child.kind == NodeKind.KEYFRAME:
                yield from _regen(project, child.node_id, note)
                for grandchild in project.children_of(child.node_id):
                    if grandchild.kind == NodeKind.SHOT:
                        yield from _regen(project, grandchild.node_id, note)

    else:
        yield _ev(type="error",
                  label="The story and the final cut are assembled from the graph — "
                        "change a character, scene or shot instead.", project_id=pid)


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
    """Shoot one more setup on an existing master frame.

    This is the canvas equivalent of calling for another angle: the scene is already
    staged and its master frame is already approved and paid for, so a new shot costs one
    animation and nothing else — no re-framing, no story rewrite, no downstream staling.

    `spec` carries whatever the director asked for (shot type, angle, move, and a free
    note); anything left blank falls back to the scene's own master framing.
    """
    pid = project.project_id
    kf = project.get(keyframe_id)
    if not kf or kf.kind != NodeKind.KEYFRAME:
        yield _ev(type="error", label="Shots are filmed from a keyframe — pick one first.",
                  project_id=pid)
        return
    if not kf.asset:
        yield _ev(type="error", project_id=pid,
                  label=f"{kf.title} has no frame yet, so there is nothing to shoot from.")
        return
    scene_node = _scene_of(project, kf)
    if not scene_node:
        yield _ev(type="error", label="That keyframe has lost its scene.", project_id=pid)
        return

    scene, dna_blocks, env = _scene_context(project, scene_node)
    cov = {
        "shot": (spec.get("shot") or "").strip() or scene.get("shot", "medium shot"),
        "angle": (spec.get("angle") or "").strip() or scene.get("angle", "eye level"),
        "move": (spec.get("move") or "").strip() or scene.get("move", "locked camera"),
        "action": (spec.get("note") or "").strip() or scene.get("action", ""),
        "intent": (spec.get("note") or "").strip(),
    }
    setup = f"{cov['shot']}, {cov['angle']}"
    # Numbered by what is already hanging off this master, so the new shot reads as the
    # next setup of the scene rather than an orphan.
    existing = [c for c in project.children_of(kf.node_id) if c.kind == NodeKind.SHOT]
    n = scene.get("n", "")

    yield _ev(label=f"Shooting another setup on scene {n} — {setup}…", project_id=pid)
    # A scene shot once is just "Shot 3"; the moment it has two setups that name is wrong,
    # because "Shot 3.2" implies a 3.1 the canvas never showed.
    if len(existing) == 1 and existing[0].title == f"Shot {n}":
        existing[0].title = f"Shot {n}.1"
        yield _ev(type="node", node=existing[0], project_id=pid)
    shot_node = project.add(Node(
        kind=NodeKind.SHOT, title=f"Shot {n}.{len(existing) + 1}",
        status=NodeStatus.RUNNING, parent_ids=[kf.node_id],
        data={"vo": "", "n": n, "i": len(existing), "setup": setup,
              "coverage": cov, "added": True}))
    yield _ev(type="node", node=shot_node, project_id=pid)

    style = _style_of(project)
    with _safe(shot_node, "animation"):
        sp = camera.shot_prompt(style, scene, dna_blocks, env, coverage=cov)
        asset, report, attempt = yield from _gated(
            shot_node, NodeKind.SHOT,
            lambda _a: gb.image_to_video(kf.asset.url, sp, duration=SHOT_SECONDS,
                                         aspect_ratio=project.settings.aspect,
                                         framing=cov.get("shot"), move=cov.get("move")),
            _target_for(project, shot_node), cfg.QC_MAX_VIDEO_REGENS, pid)
        _settle(shot_node, asset, report, attempt)
    yield _ev(type="node", node=shot_node, project_id=pid)
    yield _ev(type="done", project_id=pid,
              label=f"{shot_node.title} is in — {setup}. The master frame was reused, so "
                    f"nothing else in the film changed.")


def suggest_setup(project: Project, keyframe_id: str) -> dict | None:
    """What to shoot next on this master frame, and why.

    Reads the scene off the graph together with every setup already hanging off the frame,
    so the recommendation is the shot that is *missing* rather than one more of what we
    have. Costs a text call and renders nothing — it fills the form in, and the director
    still decides whether to take it.
    """
    kf = project.get(keyframe_id)
    if not kf or kf.kind != NodeKind.KEYFRAME:
        return None
    scene_node = _scene_of(project, kf)
    if not scene_node:
        return None

    scene, _dna, env = _scene_context(project, scene_node)
    _refs, cast = _scene_review_context(project, scene_node)
    existing = [c.data.get("coverage") or {} for c in project.children_of(kf.node_id)
                if c.kind == NodeKind.SHOT]
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
