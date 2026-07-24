"""Entity keying — the layer that makes the canvas a genuinely living graph.

The problem this solves: a scene's prose used to embed character names as literal strings
("Simeon bargains…") while the graph *also* recorded the link structurally
(`character_ids: [SIMEON]`). Two copies of one fact, guaranteed to drift the moment anyone
renames anything.

The fix is to store text with **entity tokens** and resolve them at render time:

    stored :  "{{SIMEON}} bargains, name-drops; {{USHER:lc}} does not blink"
    shown  :  "Chidi bargains, name-drops; the usher does not blink"

Renaming is then a single write to one node — every scene, logline and VO line follows
instantly, deterministically, and **without regenerating a single frame**. That distinction
matters: a rename is free, whereas anything that changes the pixels costs money and minutes.

Tokens carry an optional `:lc` case hint so mid-sentence prose still reads naturally.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..models import Node, NodeKind, NodeStatus, Project

# Text fields that may carry entity tokens, per node kind. Values may be nested (the story
# bible is a dict, the beat sheet a list of dicts) — see _map_strings.
TOKENISED_FIELDS = {
    # `plan` is the whole screenplay, kept on the story node so later stages can read their
    # inputs off the graph. It is also the only place the cast, the locations and the scene
    # breakdown exist between the story gate and the stages that build them — so it has to
    # resolve like every other piece of prose, not leak tokens into the inspector.
    NodeKind.STORY: ["logline", "bible", "beats", "plan"],
    NodeKind.SCENE: ["title", "action", "vo", "atmosphere", "intent", "coverage"],
    # `prompt` is what a rendered node was actually made from. It is stored tokenised like
    # every other piece of prose precisely so a rename reaches it — a prompt still naming
    # the old character is the one place a "free" rename would quietly stop being free.
    NodeKind.CHARACTER: ["prompt"],
    NodeKind.ENVIRONMENT: ["prompt"],
    NodeKind.KEYFRAME: ["prompt"],
    NodeKind.SHOT: ["vo", "prompt", "coverage"],
}

_TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)(:lc)?\}\}")

# Names that begin with an article are role-nouns ("The Usher"), not proper names, and
# are the only ones the :lc case hint may lowercase.
_ARTICLE_RE = re.compile(r"^(the|a|an)\s", re.IGNORECASE)


# ---------------- tokenise / resolve ----------------

def tokenize(text: str, names: dict[str, str]) -> str:
    """Replace literal entity names with tokens. Longest names first, so "The Usher"
    wins over a character called "Usher" and we never half-match a longer name."""
    if not text:
        return text or ""
    for eid, name in sorted(names.items(), key=lambda kv: -len(kv[1] or "")):
        if not name:
            continue
        # Word-boundary, case-insensitive. Lowercase matches keep a :lc hint so prose
        # like "the usher does not blink" doesn't come back capitalised mid-sentence.
        def sub(m: re.Match) -> str:
            return f"{{{{{eid}:lc}}}}" if m.group(0).islower() and not name.islower() \
                else f"{{{{{eid}}}}}"
        text = re.sub(rf"\b{re.escape(name)}\b", sub, text, flags=re.IGNORECASE)
    return text


def resolve(text: str, names: dict[str, str]) -> str:
    """Render tokens back to the entity's *current* name."""
    if not text:
        return text or ""

    def sub(m: re.Match) -> str:
        eid, lc = m.group(1), m.group(2)
        name = names.get(eid)
        if name is None:
            return m.group(0)  # unknown entity: leave the token visible rather than lie
        # The :lc hint exists for role-nouns ("The Usher" -> "the usher does not blink").
        # A proper name must survive it: rename that role to "Ngozi" and lowercasing it
        # would read "ngozi does not blink".
        if lc and _ARTICLE_RE.match(name):
            return name.lower()
        return name

    return _TOKEN_RE.sub(sub, text)


def tokens_in(text: str) -> set[str]:
    return {m.group(1) for m in _TOKEN_RE.finditer(text or "")}


def resolve_deep(value, names: dict[str, str]):
    """Resolve tokens through a nested structure — a scene's coverage list, for instance."""
    return _map_strings(value, lambda t: resolve(t, names))


def _tokens_deep(value) -> set[str]:
    """Every entity token inside a possibly-nested field."""
    found: set[str] = set()

    def collect(t: str) -> str:
        found.update(tokens_in(t))
        return t

    _map_strings(value, collect)
    return found


def _map_strings(value, fn):
    """Apply fn to every string inside a str / list / dict.

    Not every tokenised field is a flat string: the story bible is a dict and the beat sheet
    is a list of dicts. A rename has to reach into those too, or the beat sheet would still
    be talking about the character's old name.
    """
    if isinstance(value, str):
        return fn(value)
    if isinstance(value, list):
        return [_map_strings(v, fn) for v in value]
    if isinstance(value, dict):
        return {k: _map_strings(v, fn) for k, v in value.items()}
    return value


def tokenize_plan(plan: dict) -> dict:
    """Tokenise a freshly-planned film in place, so entity references are structural from
    the moment the story exists rather than being retrofitted after the first rename."""
    names = {c["id"]: c["name"] for c in plan.get("characters", [])}
    names.update({e["id"]: e["name"] for e in plan.get("environments", [])})
    # The prompt sets are written by the synthesizer in the same pass as the prose, so they
    # arrive full of literal names and have to be tokenised alongside it.
    for c in plan.get("characters", []):
        if c.get("sheet_prompt"):
            c["sheet_prompt"] = tokenize(c["sheet_prompt"], names)
    for e in plan.get("environments", []):
        if e.get("plate_prompt"):
            e["plate_prompt"] = tokenize(e["plate_prompt"], names)
    for s in plan.get("scenes", []):
        for f in ("title", "action", "vo", "atmosphere"):
            if s.get(f):
                s[f] = tokenize(s[f], names)
        if s.get("coverage"):
            s["coverage"] = _map_strings(s["coverage"], lambda t: tokenize(t, names))
    for f in ("bible", "beats"):
        if plan.get(f):
            plan[f] = _map_strings(plan[f], lambda t: tokenize(t, names))
    return plan


# ---------------- rendering for the client ----------------

def node_view(node: Node, names: dict[str, str]) -> Node:
    """A display copy of a node with every token resolved.

    The stored node keeps its tokens (that's what makes renames work); only what leaves
    the API is resolved, so the frontend never has to know tokens exist.
    """
    fields = TOKENISED_FIELDS.get(node.kind)
    if not fields:
        return node
    if not any(node.data.get(f) for f in fields):
        return node
    copy = node.model_copy(deep=True)
    for f in fields:
        if copy.data.get(f):
            copy.data[f] = _map_strings(copy.data[f], lambda t: resolve(t, names))
    # Cast chips: give the UI resolved display names alongside the stable ids.
    if copy.kind == NodeKind.SCENE and copy.data.get("character_ids"):
        copy.data["cast"] = [{"id": cid, "name": names.get(cid, cid)}
                             for cid in copy.data["character_ids"]]
    return copy


def project_view(project: Project) -> dict:
    """Whole-project dump with tokens resolved and back-references attached."""
    names = project.display_names()
    data = project.model_dump()
    data["nodes"] = [node_view(n, names).model_dump() for n in project.nodes]
    data["references"] = {eid: [r.__dict__ for r in refs]
                          for eid, refs in back_references(project).items()}
    return data


# ---------------- back-references ----------------

@dataclass
class Ref:
    """One place an entity is depended upon."""
    entity_id: str
    node_id: str
    node_title: str
    node_kind: str
    field: str          # "cast" | "environment" | "action" | "vo" | ...
    structural: bool    # True = a graph edge; False = a mention inside prose


def back_references(project: Project) -> dict[str, list[Ref]]:
    """entity_id -> every node/field that depends on it.

    This is what lets the Inspector answer "what breaks if I change this?" and what turns
    the scene card's CAST row into real links instead of decorative text.
    """
    out: dict[str, list[Ref]] = {}

    def add(eid: str, node: Node, field: str, structural: bool) -> None:
        out.setdefault(eid, []).append(
            Ref(eid, node.node_id, node.title, node.kind.value, field, structural))

    for n in project.nodes:
        # Structural edges declared by the plan.
        if n.kind == NodeKind.SCENE:
            for cid in n.data.get("character_ids", []) or []:
                add(cid, n, "cast", True)
            if n.data.get("environment_id"):
                add(n.data["environment_id"], n, "environment", True)
        # Prose mentions, discovered from the tokens themselves.
        for f in TOKENISED_FIELDS.get(n.kind, []):
            for eid in _tokens_deep(n.data.get(f) or ""):
                add(eid, n, f, False)
    return out


def rename_entity(project: Project, entity_id: str, new_name: str) -> list[Node]:
    """Rename an entity everywhere. Returns the nodes whose *rendering* changed.

    Nothing is regenerated: the token layer means the stored prose never mentioned the old
    name in the first place, so downstream frames stay valid and stay paid-for.
    """
    node = project.entity_node(entity_id)
    if not node:
        return []
    node.title = new_name
    if node.kind == NodeKind.CHARACTER:
        node.data["name"] = new_name

    names = project.entity_names()
    touched = [node]
    for ref in back_references(project).get(entity_id, []):
        n = project.get(ref.node_id)
        if n and n not in touched:
            touched.append(n)
    return [node_view(n, names) for n in touched]


# ---------------- impact analysis ----------------

@dataclass
class Impact:
    """What a proposed change would actually cost."""
    rewritten: list[dict] = field(default_factory=list)   # free, instant text updates
    stale: list[dict] = field(default_factory=list)       # media needing re-render
    cost_hint: str = ""


def _descendants(project: Project, node_id: str) -> list[Node]:
    seen, out, queue = {node_id}, [], list(project.children_of(node_id))
    while queue:
        n = queue.pop(0)
        if n.node_id in seen:
            continue
        seen.add(n.node_id)
        out.append(n)
        queue.extend(project.children_of(n.node_id))
    return out


def mark_stale(project: Project, node_id: str) -> list[Node]:
    """Invalidate everything that inherited from a node. Returns what changed."""
    out = []
    for d in _descendants(project, node_id):
        d.status = NodeStatus.STALE
        out.append(d)
    return out


def impact_of(project: Project, node_id: str, change: str = "semantic") -> Impact:
    """Dry-run a change so the user can see the blast radius before paying for it.

    `change="rename"` is the cheap path — text re-resolves and no media is invalidated.
    `change="semantic"` alters what the thing *looks like*, so every descendant frame and
    shot is invalidated and must be re-rendered.
    """
    node = project.get(node_id)
    imp = Impact()
    if not node:
        return imp

    entity_id = node.data.get("id")

    if change == "rename" and entity_id:
        names = project.entity_names()
        for ref in back_references(project).get(entity_id, []):
            imp.rewritten.append({
                "node_id": ref.node_id, "title": resolve(ref.node_title, names),
                "kind": ref.node_kind, "field": ref.field, "structural": ref.structural,
            })
        imp.cost_hint = "Text only — no frames are re-rendered, nothing is re-paid for."
        return imp

    media_kinds = {NodeKind.KEYFRAME, NodeKind.SHOT, NodeKind.CHARACTER,
                   NodeKind.ENVIRONMENT, NodeKind.TIMELINE}
    for d in _descendants(project, node_id):
        entry = {"node_id": d.node_id, "title": d.title, "kind": d.kind.value}
        (imp.stale if d.kind in media_kinds else imp.rewritten).append(entry)

    n_media = len(imp.stale)
    imp.cost_hint = (f"{n_media} asset{'s' if n_media != 1 else ''} need re-rendering."
                     if n_media else "Nothing downstream needs re-rendering.")
    return imp
