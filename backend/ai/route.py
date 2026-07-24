"""Intent router — turns a free-text director's note into a target on the graph.

Without this, `run_edit` demanded a `target_node_id` and the headline interaction
("make the ending more emotional") failed unless the user had already clicked the right
node. The whole pitch is a creative director you talk to, so the system has to work out
*what you meant* by itself.

Two tiers, deliberately:
  * an LLM pass that sees the actual node list and picks a target;
  * a keyword heuristic that runs when there's no key — so the keyless demo still works.

It also classifies the *kind* of change, because that decides what it costs:
`rename` re-resolves text for free, while `semantic` invalidates rendered frames.
"""
from __future__ import annotations

import json
import re

from ..config import get_config
from ..models import NodeKind, Project
from ..pipeline import genblaze_client as gb
from . import entities

cfg = get_config()

_SYSTEM = """You route a film director's note to ONE node in a production graph.
Reply with STRICT JSON only:
{"node_id": "<id from the list>", "change": "rename"|"semantic", "new_name": "<only if rename>"}
Rules:
- "change":"rename" ONLY when the note asks to call a character/place by a different name.
- Otherwise "semantic".
- Prefer the most specific node that satisfies the note. Endings mean the last scene;
  openings mean the first scene. A note about how someone looks targets that character."""

# Notes that are explicitly about naming — these must never cost a re-render.
_RENAME_RE = re.compile(
    r"\b(?:re)?name\b.*?\b(?:to|as)\b\s+[\"']?([\w' -]{2,40})[\"']?|"
    r"\bcall (?:him|her|them|it|the \w+)\s+[\"']?([\w' -]{2,40})[\"']?",
    re.IGNORECASE)


def rename_intent(instruction: str) -> str | None:
    """The new name a note plainly asks for, or None.

    Useful even when the target is already known: picking a node — or @-referencing one —
    says *which* node the note is about, not what kind of change it is. Without this, an
    addressed "call her Ada" would be classified as semantic and cost a re-render.
    """
    m = _RENAME_RE.search(instruction)
    return next((g for g in (m.groups() if m else ()) if g), None)


def _nodes_for_prompt(project: Project) -> list[dict]:
    names = project.entity_names()
    out = []
    for n in project.nodes:
        if n.kind == NodeKind.TIMELINE:
            continue
        out.append({"node_id": n.node_id, "kind": n.kind.value,
                    "title": entities.resolve(n.title, names),
                    "summary": entities.resolve(str(n.data.get("action")
                                                    or n.data.get("dna")
                                                    or n.data.get("desc") or "")[:120], names)})
    return out


def _heuristic(project: Project, instruction: str) -> tuple[str | None, str, str | None]:
    """Keyword routing — the keyless path. Ordered most-specific first."""
    text = instruction.lower()
    names = project.entity_names()

    new_name = rename_intent(instruction)

    # 1) An entity named outright wins — that's the least ambiguous signal there is.
    for eid, name in sorted(names.items(), key=lambda kv: -len(kv[1] or "")):
        if name and re.search(rf"\b{re.escape(name.lower())}\b", text):
            node = project.entity_node(eid)
            if node:
                return node.node_id, ("rename" if new_name else "semantic"), new_name

    scenes = sorted(project.by_kind(NodeKind.SCENE), key=lambda n: n.data.get("n", 0))
    if scenes:
        # 2) Positional language.
        if re.search(r"\b(ending|end|final|last|closing|finale)\b", text):
            return scenes[-1].node_id, "semantic", None
        if re.search(r"\b(opening|open|beginning|start|first|intro)\b", text):
            return scenes[0].node_id, "semantic", None
        # 3) An explicit scene number.
        sm = re.search(r"\bscene\s*(\d+)\b", text)
        if sm:
            want = int(sm.group(1))
            hit = next((s for s in scenes if s.data.get("n") == want), None)
            if hit:
                return hit.node_id, "semantic", None
        # 4) Title word overlap.
        words = {w for w in re.findall(r"[a-z]{4,}", text)}
        best, score = None, 0
        for s in scenes:
            title = entities.resolve(s.title, names).lower()
            hits = len(words & set(re.findall(r"[a-z]{4,}", title)))
            if hits > score:
                best, score = s, hits
        if best:
            return best.node_id, "semantic", None

    return None, "semantic", None


def route(project: Project, instruction: str) -> tuple[str | None, str, str | None]:
    """(node_id, change_kind, new_name). node_id is None when nothing matched."""
    # A clearly-phrased rename is unambiguous and free — don't spend a model call on it,
    # and don't risk an LLM classifying it as semantic and burning a re-render.
    h_node, h_change, h_name = _heuristic(project, instruction)
    if h_change == "rename" and h_node:
        return h_node, "rename", h_name

    if not cfg.mock_text():
        try:
            raw = gb.chat(
                _SYSTEM,
                json.dumps({"note": instruction, "nodes": _nodes_for_prompt(project)}),
                json_mode=True, temperature=0)
            data = json.loads(re.search(r"\{.*\}", raw, re.DOTALL).group(0))
            nid = data.get("node_id")
            if nid and project.get(nid):
                change = "rename" if data.get("change") == "rename" else "semantic"
                return nid, change, data.get("new_name") or h_name
        except Exception:
            pass

    return h_node, h_change, h_name
