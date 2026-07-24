"""Coverage agent — what to shoot next, and why.

The scene is already written and already staged. The only question this agent answers is
the one a director asks standing next to the camera: *given what we have in the can, what
is the next setup worth taking?*

That makes existing coverage the most important input. A recommendation that ignores it
would keep proposing the wide shot you already have; the useful answer is always the frame
that is **missing** — the reaction nobody covered, the detail the wide can't hold, the
angle that would let the scene cut together.

Runs on an LLM when a key exists. Without one it falls back to a coverage ladder, which is
not a placeholder: "wide to establish, then closer as the scene tightens, then the insert
that pays it off" is the actual grammar, and following it produces a defensible next setup
every time.
"""
from __future__ import annotations

import json
import re

from ..config import get_config
from ..pipeline import genblaze_client as gb

cfg = get_config()

# The vocabulary the canvas offers. A recommendation outside it can't be rendered as a
# selection, so anything the model invents is snapped back into this set.
SHOTS = ["wide shot", "medium shot", "medium two-shot", "close-up",
         "over-the-shoulder", "insert"]
ANGLES = ["eye level", "low angle", "high angle", "dutch angle"]
MOVES = ["locked camera", "slow push-in", "slow pull-back", "handheld drift", "slow pan"]

_SYSTEM = """You are a director deciding the next camera setup for a scene that is already
written, staged and lit. One master frame exists; every setup is that same moment filmed
from a different position.

Recommend the ONE setup that adds the most to what is already covered. Rules:
- Never repeat a setup already in the can, and never repeat its job.
- The setup must serve this scene's intent. Comedy lands in a face; tension lives in the
  space between two people; a payoff usually needs the room.
- Suggest a detail insert only when there is a specific object or action worth isolating.
- Reason about what a cut needs, not about what would look nice.

Reply with JSON only:
{"shot":"<one of the shot list>","angle":"<one of the angle list>",
 "move":"<one of the move list>","note":"what this setup is for, <=14 words"}"""


def _closest(value: str, options: list[str], fallback: str) -> str:
    """Snap a free-text answer onto the vocabulary the canvas can actually render."""
    v = (value or "").strip().lower()
    if not v:
        return fallback
    if v in options:
        return v
    return next((o for o in options if o in v or v in o), fallback)


def _ladder(scene: dict, existing: list[dict]) -> dict:
    """The keyless recommendation: the next rung of standard coverage, biased by intent.

    Reads what has been shot and proposes the widest gap in it. This is the grammar a
    scene is normally covered in, so the answer is a real recommendation rather than a
    stand-in for one.
    """
    have = {(c.get("shot") or "").lower() for c in existing}
    intent = (scene.get("intent") or "").lower()
    cast = len(scene.get("character_ids") or [])

    # What the scene is FOR decides which frame is worth taking first.
    if "comedy" in intent or "payoff" in intent or "reveal" in intent:
        order = ["close-up", "medium shot", "over-the-shoulder", "wide shot", "insert"]
    elif "tension" in intent:
        order = ["over-the-shoulder", "close-up", "medium two-shot", "insert", "wide shot"]
    elif "establish" in intent or "world" in intent:
        order = ["wide shot", "medium shot", "insert", "close-up", "over-the-shoulder"]
    else:
        order = ["medium shot", "close-up", "wide shot", "over-the-shoulder", "insert"]

    # Two-handers get the two-shot rather than the single: the point of the frame is the
    # pair, and a scene with one person in it has no two-shot to take.
    if cast > 1:
        order = ["medium two-shot" if s == "medium shot" else s for s in order]
    else:
        order = [s for s in order if s not in ("medium two-shot", "over-the-shoulder")]

    shot = next((s for s in order if s not in have), "close-up")

    angle = "eye level"
    if shot == "wide shot":
        angle = "high angle" if "payoff" in intent else "low angle"
    elif shot == "insert":
        angle = "high angle"

    move = {"wide shot": "slow pull-back", "close-up": "locked camera",
            "insert": "slow push-in", "over-the-shoulder": "handheld drift"}.get(
        shot, "slow push-in")

    why = {
        "close-up": "land the beat on a face",
        "medium two-shot": "hold both of them in one frame",
        "over-the-shoulder": "put us behind the person being worked on",
        "insert": "isolate the detail the wide can't hold",
        "wide shot": "show the room the scene happens in",
        "medium shot": "stay with the action at working distance",
    }.get(shot, "cover the beat from a second position")

    return {"shot": shot, "angle": angle, "move": move, "note": why, "source": "ladder"}


def _brief(scene: dict, style: str, existing: list[dict], cast: str, env: str) -> str:
    have = "\n".join(
        f"  - {c.get('shot','')}, {c.get('angle','')} — {c.get('action') or c.get('intent') or ''}"
        for c in existing) or "  (nothing shot yet — this is the scene's first setup)"
    return (f"SCENE {scene.get('n','')}: {scene.get('title','')}\n"
            f"ACTION: {scene.get('action','')}\n"
            f"INTENT: {scene.get('intent') or 'unstated'}\n"
            f"CAST IN FRAME: {cast or 'unspecified'}\n"
            f"LOCATION: {env}\n"
            f"DIALOGUE: {scene.get('vo') or 'none'}\n"
            f"MASTER FRAMING: {scene.get('shot','medium shot')}, {scene.get('angle','eye level')}\n"
            f"STYLE: {style}\n\n"
            f"ALREADY IN THE CAN:\n{have}\n\n"
            f"SHOT LIST: {', '.join(SHOTS)}\n"
            f"ANGLE LIST: {', '.join(ANGLES)}\n"
            f"MOVE LIST: {', '.join(MOVES)}")


def suggest(scene: dict, style: str, existing: list[dict], *, cast: str = "",
            env: str = "") -> dict:
    """Recommend the next setup for a scene. Always returns something shootable.

    The ladder is the floor, not the fallback of last resort: when the model is unavailable
    or answers with something unusable, the returned setup is still one a director could
    defend — and the caller is told which of the two produced it.
    """
    floor = _ladder(scene, existing)
    if cfg.mock_text():
        return floor

    try:
        raw = gb.chat(_SYSTEM, _brief(scene, style, existing, cast, env),
                      json_mode=True, temperature=0.4)
    except Exception:
        return floor
    if not raw:
        return floor

    try:
        blob = json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            return floor
        try:
            blob = json.loads(m.group(0))
        except Exception:
            return floor

    shot = _closest(blob.get("shot"), SHOTS, floor["shot"])
    # A model that hands back a setup we already have is answering the wrong question;
    # the ladder's whole job is knowing what is missing, so defer to it.
    if shot in {(c.get("shot") or "").lower() for c in existing}:
        return floor

    return {
        "shot": shot,
        "angle": _closest(blob.get("angle"), ANGLES, floor["angle"]),
        "move": _closest(blob.get("move"), MOVES, floor["move"]),
        "note": str(blob.get("note") or floor["note"])[:120],
        "source": "llm",
    }
