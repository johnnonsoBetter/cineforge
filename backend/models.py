"""Pydantic schemas. The canvas is a living graph: every node carries parent_ids so an
edit upstream can mark downstream nodes stale and offer targeted regeneration."""
from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field
import time
import uuid


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


class NodeKind(str, Enum):
    STORY = "story"
    CHARACTER = "character"
    ENVIRONMENT = "environment"
    SCENE = "scene"
    KEYFRAME = "keyframe"
    SHOT = "shot"
    TIMELINE = "timeline"


class NodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    READY = "ready"
    STALE = "stale"        # an upstream parent changed
    FAILED = "failed"
    FLAGGED = "flagged"    # QC failed twice -> needs a human


class Provenance(BaseModel):
    """Mirror of a Genblaze manifest summary, persisted alongside each asset in B2."""
    provider: Optional[str] = None
    model: Optional[str] = None
    prompt: Optional[str] = None
    sha256: Optional[str] = None
    manifest_uri: Optional[str] = None
    canonical_hash: Optional[str] = None
    verified: Optional[bool] = None
    parent_run_id: Optional[str] = None


class Asset(BaseModel):
    asset_id: str = Field(default_factory=lambda: _id("asset"))
    kind: NodeKind
    url: Optional[str] = None            # B2 durable URL (or mock placeholder)
    thumbnail: Optional[str] = None
    duration_sec: Optional[float] = None
    provenance: Provenance = Field(default_factory=Provenance)


# ---- QC: the review agent's output ----
#
# QC is a *sighted* judgement, not a label. The report therefore records not only the
# verdict but what the judge was looking at when it reached it — which frames of the asset,
# which reference images it compared them against, and how each individual criterion
# landed. A verdict you can't audit is a verdict nobody will trust on a paid run.

class QCReference(BaseModel):
    """A reference image the judge compared the asset against."""
    url: str
    label: str                          # "Simeon (character sheet)"
    node_id: Optional[str] = None       # so the UI can click through to the source node


class QCCheck(BaseModel):
    """One criterion, judged."""
    criterion: str                      # identity | framing | style | environment | …
    ok: bool
    score: float = 0.0                  # 0..1 — how confidently the criterion holds
    note: str = ""


class QCReport(BaseModel):
    verdict: str = "PASS"               # PASS | BORDERLINE | FAIL | FLAGGED | SKIPPED | ERROR
    summary: str = ""
    checks: list[QCCheck] = Field(default_factory=list)
    criteria: list[str] = Field(default_factory=list)     # what it was asked to check
    frames: list[str] = Field(default_factory=list)       # frames of the asset it saw
    references: list[QCReference] = Field(default_factory=list)
    attempt: int = 0                    # which generation attempt this judged
    source: str = "vision"              # vision | mock | unavailable | error
    model: Optional[str] = None
    judged_at: float = Field(default_factory=time.time)

    def failed(self) -> list[QCCheck]:
        return [c for c in self.checks if not c.ok]


class Version(BaseModel):
    """One take of a node's asset.

    Every generation appends a take; none is ever overwritten. A regeneration you dislike
    has to be recoverable — otherwise "try it another way" is a destructive act, and the
    frame you already paid for is gone.
    """
    version: int
    asset: Asset
    note: Optional[str] = None          # the director's note that produced this take
    qc: Optional[QCReport] = None       # the review this take was accepted (or flagged) on
    created_at: float = Field(default_factory=time.time)


# ---- stages: the film is built in four gated passes, not one sweep ----
#
# SYNTHESIS writes the film — bible, dialogue, cast, locations, breakdown, and every prompt
# the three generation passes will spend. SHEETS renders the founding references. KEYFRAMES
# composes one still per generation unit from those locked references. VIDEO animates each
# still and cuts the result together.
#
# Only the first pass is creative. The three after it are mechanical: they read a prompt off
# the graph and send it. That is what makes the gates worth standing at — what a director
# approves at the end of synthesis is literally what the rest of the pipeline will execute.
#
# Every gate stops. There is no mode in which a stage starts itself, because the stages get
# progressively more expensive and each inherits the mistakes of the one before it. A wrong
# character sheet is one bad image; the same sheet waved through is a whole film of the wrong
# person. The gate is the point where that costs one re-render instead of a hundred.

STAGE_KEYS = ["synthesis", "sheets", "keyframes", "video"]

STAGE_LABELS = {
    "synthesis": "Story bible", "sheets": "Reference sheets",
    "keyframes": "Keyframes", "video": "Video",
}


class StageStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    AWAITING = "awaiting"   # nothing wrong — the pass is done and waiting on the director
    BLOCKED = "blocked"     # the gate found something a human has to settle
    APPROVED = "approved"   # cleared; the next stage may start
    FAILED = "failed"


class StageBlocker(BaseModel):
    """One reason a stage did not clear, pointing at the node responsible."""
    node_id: str
    title: str
    kind: str
    reason: str


class StageGate(BaseModel):
    """The decision at the end of a stage.

    `verdict` is what the review agent found; `decided_by` is who acted on it. Keeping the
    two apart is the whole point: only a human ever opens a gate, and one who opens it over
    a hold has to leave a different record than one who opens it over a clear — otherwise
    the ledger is claiming a pass the reviewer never gave.
    """
    stage: str
    verdict: str = "clear"                 # clear | hold
    summary: str = ""
    blockers: list[StageBlocker] = Field(default_factory=list)
    reviewed: int = 0
    decided_by: Optional[str] = None       # ai | human
    decided_at: Optional[float] = None
    note: Optional[str] = None             # the director's reason, when a human decided


class StageRecord(BaseModel):
    """One stage's place in the run."""
    key: str
    status: StageStatus = StageStatus.PENDING
    node_ids: list[str] = Field(default_factory=list)
    gate: Optional[StageGate] = None
    started_at: Optional[float] = None
    ended_at: Optional[float] = None

    @property
    def label(self) -> str:
        return STAGE_LABELS.get(self.key, self.key)


class Node(BaseModel):
    node_id: str = Field(default_factory=lambda: _id("node"))
    kind: NodeKind
    title: str
    status: NodeStatus = NodeStatus.PENDING
    parent_ids: list[str] = Field(default_factory=list)
    data: dict = Field(default_factory=dict)   # kind-specific payload (script text, dna, etc.)
    asset: Optional[Asset] = None              # the *accepted* take
    versions: list[Version] = Field(default_factory=list)
    accepted_version: Optional[int] = None
    locked: bool = False                       # locked nodes are skipped by regeneration
    qc: Optional[QCReport] = None              # the review behind the accepted take
    attempt: int = 0

    def push_version(self, asset: "Asset", *, note: str | None = None,
                     qc: "QCReport | None" = None) -> "Version":
        """Record a new take and accept it. `asset` stays the accepted take, so everything
        downstream keeps reading one field and never has to know about history."""
        v = Version(version=len(self.versions) + 1, asset=asset, note=note, qc=qc)
        self.versions.append(v)
        self.asset, self.accepted_version = asset, v.version
        self.qc = qc
        return v

    def select_version(self, version: int) -> bool:
        """Accept an earlier take. Free — the asset already exists and is already paid for.

        The take's own review comes back with it: a verdict belongs to the pixels it was
        passed, so it can never be carried over from a take we just stopped showing.
        """
        v = next((x for x in self.versions if x.version == version), None)
        if not v:
            return False
        self.asset, self.accepted_version = v.asset, v.version
        self.qc = v.qc
        return True


SHOT_SECONDS = 8   # every shot is one image2video clip; runtime is shots × this

# Planning assumption only. Real coverage is decided per scene by the story agent — some
# scenes earn one setup, some earn three — but the scene count has to be fixed *before*
# anything is written, so it is derived from a typical figure and then let go of.
TYPICAL_COVERAGE = 2


class ProjectSettings(BaseModel):
    """The film's production constraints.

    Every field here reaches generation — length sets how many scenes get written, aspect is
    the ratio frames are actually rendered at, language is the language dialogue is written
    in. A setting that only changed a label would be a lie told in the UI.
    """
    length_min: int = 1                 # 1 | 3 | 5
    style_preset: str = "cinematic"
    aspect: str = "16:9"                # 16:9 landscape | 9:16 vertical | 1:1 square
    language: str = "English"

    def target_shots(self) -> int:
        """Shots needed to fill the requested runtime. Every shot is one clip."""
        return max(3, round(self.length_min * 60 / SHOT_SECONDS))

    def target_scenes(self) -> int:
        """How many scenes to write, so the shot budget lands near the requested runtime.

        The story agent then spends that budget unevenly across these scenes, which is why
        this is a planning figure rather than a promise about the final cut.
        """
        return max(3, round(self.target_shots() / TYPICAL_COVERAGE))


class Project(BaseModel):
    project_id: str = Field(default_factory=lambda: _id("proj"))
    title: str = "Untitled Film"
    idea: str = ""
    settings: ProjectSettings = Field(default_factory=ProjectSettings)
    nodes: list[Node] = Field(default_factory=list)
    export_url: Optional[str] = None       # stitched final cut, once rendered
    story_source: str = "sample"           # "llm" when the screenplay is bespoke
    stages: list[StageRecord] = Field(default_factory=list)

    def ensure_stages(self) -> list[StageRecord]:
        """The stage board, created on first use and filled in for older projects.

        Written this way rather than as a default so a project saved before stages existed
        — or one saved when the list was shorter — comes back with a complete board instead
        of a run that silently skips a pass.
        """
        have = {s.key for s in self.stages}
        for key in STAGE_KEYS:
            if key not in have:
                self.stages.append(StageRecord(key=key))
        self.stages.sort(key=lambda s: STAGE_KEYS.index(s.key))
        return self.stages

    def stage(self, key: str) -> Optional[StageRecord]:
        return next((s for s in self.ensure_stages() if s.key == key), None)

    def next_stage(self) -> Optional[StageRecord]:
        """The first stage that has not cleared its gate — where the run resumes."""
        return next((s for s in self.ensure_stages()
                     if s.status != StageStatus.APPROVED), None)

    def add(self, node: Node) -> Node:
        self.nodes.append(node)
        return node

    def get(self, node_id: str) -> Optional[Node]:
        return next((n for n in self.nodes if n.node_id == node_id), None)

    def children_of(self, node_id: str) -> list[Node]:
        return [n for n in self.nodes if node_id in n.parent_ids]

    def by_kind(self, kind: "NodeKind") -> list[Node]:
        return [n for n in self.nodes if n.kind == kind]

    def entity_node(self, entity_id: str) -> Optional[Node]:
        """Characters and environments are addressed by their stable plan id (SIMEON, HALL),
        which outlives any rename of their display title."""
        return next((n for n in self.nodes
                     if n.kind in (NodeKind.CHARACTER, NodeKind.ENVIRONMENT)
                     and n.data.get("id") == entity_id), None)

    def entity_names(self) -> dict[str, str]:
        """entity_id -> current display name. The single source of truth that every
        tokenised piece of text resolves against."""
        return {n.data["id"]: n.title for n in self.nodes
                if n.kind in (NodeKind.CHARACTER, NodeKind.ENVIRONMENT) and n.data.get("id")}

    def display_names(self) -> dict[str, str]:
        """entity_id -> the name to *show*, including entities the story named but no stage
        has built yet.

        Between the story gate and the cast stage the film has a full cast on paper and not
        one character node, so `entity_names()` is empty and every tokenised line would
        render as "{{SIMEON}} arrives dressed for…". The screenplay's own names are the
        fallback. A built node always wins, because a rename lives on the node and the plan
        is never rewritten.
        """
        story = next((n for n in self.nodes if n.kind == NodeKind.STORY), None)
        plan = (story.data.get("plan") if story else None) or {}
        names = {e["id"]: e["name"]
                 for e in (plan.get("characters") or []) + (plan.get("environments") or [])
                 if isinstance(e, dict) and e.get("id") and e.get("name")}
        names.update(self.entity_names())
        return names


# ---- API request/event shapes ----

class CreateProjectRequest(BaseModel):
    idea: str
    title: Optional[str] = None
    settings: Optional[ProjectSettings] = None


class EditRequest(BaseModel):
    """Conversational edit, e.g. 'make the ending more emotional'.

    Also the body for `/api/edit/propose`: the same note and target, answered with a
    Proposal the director can look at before anything is written or re-rendered.
    """
    project_id: str
    instruction: str
    target_node_id: Optional[str] = None


class ApplyEditRequest(BaseModel):
    """Execute a proposal the director approved at the composer.

    Only the fields apply actually acts on are round-tripped — the rest of the proposal was
    the director's to read, not the server's to trust. Impact and cost are re-derived from
    the graph at apply time, so a proposal that went stale between proposing and applying
    changes what happens rather than lying about it. `to` may differ from the proposed value
    because the card lets the director edit it before approving.
    """
    project_id: str
    target_node_id: str
    change: str                          # "rename" | "field" | "note"
    field: Optional[str] = None          # field edits only: "dna" | "desc" | "action"
    to: Optional[str] = None             # field edits only: the approved new value
    note: Optional[str] = None           # note edits: the instruction to fold into the prompt
    new_name: Optional[str] = None       # rename only


class RegenerateRequest(BaseModel):
    """Targeted regeneration of one node, e.g. the canvas' per-node Regenerate button."""
    project_id: str
    node_id: str
    note: Optional[str] = None


class RenameEntityRequest(BaseModel):
    """Rename a character/environment. Propagates through every tokenised text field
    without invalidating a single generated frame."""
    project_id: str
    entity_id: str
    new_name: str


class SelectVersionRequest(BaseModel):
    """Accept an earlier take of a node. Costs nothing — the asset already exists."""
    project_id: str
    node_id: str
    version: int


class LockRequest(BaseModel):
    """Lock a node so regeneration passes over it — the consistency lock for a reference
    sheet you're happy with."""
    project_id: str
    node_id: str
    locked: bool


class AddShotRequest(BaseModel):
    """Call for another setup on a keyframe that already exists.

    The scene is staged and its master frame is paid for, so this buys one animation. Every
    field of the setup is optional — anything left blank falls back to the scene's own
    master framing, which is what makes "just give me a close-up" a complete request.
    """
    project_id: str
    keyframe_id: str
    shot: Optional[str] = None      # wide shot | medium shot | close-up | over-the-shoulder…
    angle: Optional[str] = None     # low angle | eye level | high angle | dutch angle
    move: Optional[str] = None      # locked camera | slow push-in | handheld drift…
    note: Optional[str] = None      # free direction: what this setup is for

    def spec(self) -> dict:
        return {"shot": self.shot, "angle": self.angle, "move": self.move, "note": self.note}


class QCReviewRequest(BaseModel):
    """Re-review a node's current take without regenerating it.

    Reviewing is the cheap half of the gate — it re-reads pixels that already exist. That
    makes a second opinion, or a first one after the criteria changed, something you can
    ask for without paying for another render.
    """
    project_id: str
    node_id: str


class QCAcceptRequest(BaseModel):
    """Keep a take the gate did not clear.

    The reviewer is an opinion, not an authority — a human who has looked at the frame is
    allowed to overrule it. The override is recorded rather than silently applied, so the
    ledger never claims a verdict the gate did not actually reach.
    """
    project_id: str
    node_id: str


class StageDecisionRequest(BaseModel):
    """Open a gate, or hold it shut.

    Approving is the only way past a stage the review agent stopped, which is what makes the
    gate real: the run cannot spend the next stage's money on its own once something is
    outstanding. `note` is the director's reason, kept beside the gate's own verdict.
    """
    project_id: str
    stage: str
    note: Optional[str] = None


class StageEvent(BaseModel):
    """Streamed to the canvas. `label` is user-facing (never an agent/tool name).

    `progress` events are separate from `stage` events on purpose: stage lines are the
    director talking, progress ticks drive the production monitor. Mixing them would either
    spam the conversation or leave the monitor guessing.

    `qc` events are separate again: the reviewer is its own voice in the run, and a verdict
    has to be visible as it lands — not only afterwards, buried in the node it changed.

    `stage_status` and `gate` events narrate the run's shape rather than its contents: which
    pass is open, and what happened at the gate that closed it. A run that stops has to say
    so on the stream, because "the stream ended" and "the stream ended and it's your move"
    look identical to a client otherwise.
    """
    type: str = "stage"          # stage | node | progress | qc | stage_status | gate | done | error
    label: Optional[str] = None  # e.g. "Designing characters…"
    node: Optional[Node] = None
    project_id: Optional[str] = None
    stage: Optional[str] = None  # stable stage key, e.g. "keyframes" — progress/status/gate
    done: Optional[int] = None
    total: Optional[int] = None
    qc: Optional[QCReport] = None    # qc only: the report just filed
    node_id: Optional[str] = None    # qc only: which node it was filed against
    stage_status: Optional[StageStatus] = None   # stage_status only
    gate: Optional[StageGate] = None             # gate only: the decision just reached
