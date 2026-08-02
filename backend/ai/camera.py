"""Camera / prompt agent — ports the studio's 5-layer prompt format (prompt_format.md).

Pure functions (no API). Two jobs, and the second is the one that shapes the pipeline:

1. Build a copy-ready prompt from a scene and its in-frame character DNA.
2. Guarantee that *every* prompt the film will spend exists in the bible before the first
   render — `ensure_prompts`.

Synthesis is asked to write all three prompt sets itself, because a prompt written by the
agent that wrote the scene knows things a formatter cannot infer. But a prompt set is only
useful if it is complete, and a single missing field would otherwise strand a unit with
nothing to send. So anything synthesis leaves blank is composed here instead. The generation
stages therefore never build a prompt: they read one off the graph and send it, and what the
director approved at the first gate is literally what gets executed.
"""
from __future__ import annotations

import re


def _intent(scene: dict) -> str:
    """A scene's purpose, expressed as direction. What a shot is FOR should bias how it is
    composed — a comedy beat and an emotional payoff are not framed the same way."""
    i = (scene.get("intent") or "").strip()
    return f"This shot exists to {i}; compose for that. " if i else ""


def _setup(scene: dict, unit: dict) -> tuple[str, str, str, str]:
    """A unit's framing, falling back to the scene's own staging for anything blank."""
    u = unit or {}
    return (u.get("shot") or scene.get("shot", "medium shot"),
            u.get("angle") or scene.get("angle", "eye level"),
            u.get("move") or scene.get("move", "locked camera"),
            u.get("action") or scene.get("action", ""))


def _who(dna_blocks: list[str]) -> str:
    return " ".join(f"[{d}]" for d in dna_blocks) if dna_blocks else ""


# ---- the identity layer ----------------------------------------------------
#
# A character is stored in layers, not one blob: an *identity* (permanent physical traits — the
# hard lock every frame must match) and a *wardrobe* (the costume, held consistent across the
# film) and a one-phrase bearing. `dna` — the compact string every downstream prompt, the QC
# gate and the whole UI read — is then composed from those layers rather than stored beside
# them, so it can never drift from the identity a director actually edits. Keeping the two as
# separate layers is what lets the prompt lock identity hardest and name wardrobe after it.

# The identity fields, in the order they read as a description ("Nigerian man, early 40s, dark
# brown skin…"). This is the one source of truth for that order; the story normaliser keys off
# the same tuple so the two cannot disagree on what a character's identity is.
IDENTITY_FIELDS = ("ethnicity", "gender", "age", "build", "skin", "hair", "eyes", "features")


def identity_block(identity: dict | None) -> str:
    """Render the structured identity layer to the compact clause a prompt wants.

    Ethnicity and gender lead as one noun phrase ("Nigerian man"); the remaining traits follow
    as comma-separated clauses. Blank fields are dropped, so a sparsely-filled identity still
    reads cleanly.
    """
    d = identity if isinstance(identity, dict) else {}
    lead = " ".join(x for x in (d.get("ethnicity"), d.get("gender")) if (x or "").strip()).strip()
    rest = [str(d.get(k)).strip() for k in IDENTITY_FIELDS[2:] if (d.get(k) or "").strip()]
    return ", ".join(([lead] if lead else []) + rest)


def character_dna(identity: dict | None = None, wardrobe: str = "", bearing: str = "") -> str:
    """The compact visual label for a character, composed from its layers."""
    parts = [identity_block(identity), (wardrobe or "").strip(), (bearing or "").strip()]
    return ", ".join(p for p in parts if p)


# ---- the three prompt sets -------------------------------------------------

# The one thing every founding character sheet holds in common, whatever the film: a fixed
# studio setup. Pinning it here — rather than leaving each sheet's backdrop to the idea — is
# what makes the cast read as one set of references instead of one-off portraits, and the plain
# seamless backdrop is what lets a sheet be matted to a cutout later if a shot ever needs it.
SHEET_CONTRACT = (
    "Full-body character turnaround: front, three-quarter and profile views of the SAME "
    "person, identical in every view, plus a head-and-shoulders close-up. Seamless plain "
    "light-grey studio backdrop, even shadowless softbox lighting, no props, no set, no floor "
    "line or cast shadow. Orthographic identity view for reference use."
)


def sheet_prompt(style: str, dna: str) -> str:
    """Set 1a — a character's founding reference sheet: the film's look, this character's
    identity, and the fixed studio contract every sheet shares."""
    return f"{style}. Character reference sheet: {dna}. {SHEET_CONTRACT}"


def plate_prompt(style: str, desc: str) -> str:
    """Set 1b — an unpopulated establishing plate of a location."""
    return f"{style}. Establishing plate: {desc}. no people"


def keyframe_prompt(style: str, scene: dict, dna_blocks: list[str], environment: str,
                    unit: dict | None = None) -> str:
    """Set 2 — the still for one generation unit.

    One frame per unit, not per scene: this image is the first frame of exactly one clip, so
    it is composed at that clip's own framing rather than at a master framing the clip would
    then have to be re-framed away from.

    Consistency across the units of a scene comes from the locked reference sheets every one
    of them is composed against, which is why the sheets gate is the one that matters most.
    Saying "same location, wardrobe and light as the rest of the scene" explicitly is the
    other half of it.
    """
    shot, angle, _move, action = _setup(scene, unit or {})
    return (
        f"{style}. {_who(dna_blocks)} {action}. "
        f"{environment}, {scene.get('time','day')}, {scene.get('atmosphere','')}. "
        f"{shot}, {angle}, subject on the thirds with a foreground layer for depth. "
        f"This is the first frame of a single continuous shot: faces, wardrobe and lighting "
        f"clearly readable, and identical to the rest of scene {scene.get('n','')} — same "
        f"location, same wardrobe, same light, same time of day. "
        f"{_intent(scene)}"
        # Identity is the permanent layer and the hard lock — face, build, hair and skin must
        # match the sheet exactly. Wardrobe and grade are held too, but they are named after
        # identity, not lumped with it, so the model spends its fidelity on the face first.
        f"Match the reference sheets: same face, build, hair and skin above all, then the same "
        f"wardrobe and film-style grade."
    ).strip()


def video_prompt(style: str, scene: dict, dna_blocks: list[str], environment: str,
                 unit: dict | None = None) -> str:
    """Set 3 — the 5-layer animation prompt for one generation unit (Layer 1 STYLE → 5 AUDIO).

    The source image is this unit's own approved still, so the prompt asks for that exact
    frame to *start moving* rather than for a re-framing of somebody else's frame. That is
    the whole benefit of one still per clip: nothing has to be re-composed at video time,
    which is the stage where a mistake is most expensive to catch.
    """
    u = unit or {}
    shot, angle, move, action = _setup(scene, u)
    dialogue = scene.get("vo", "")
    audio = (f"Ambient {environment} sounds. "
             + (f'Dialogue (lip-sync, one speaker): "{dialogue}". ' if dialogue else "")
             + "No music.")
    why = (u.get("intent") or "").strip()

    return (
        f"{style}. {_who(dna_blocks)} {action}. {environment}, {scene.get('time','day')}. "
        f"{shot}, {angle}, {move}. "
        f"THE SOURCE IMAGE IS THE FIRST FRAME OF THIS SHOT: hold its location, cast, "
        f"wardrobe, props and lighting exactly, and animate forward from it. "
        f"Continuous real-time action filling the shot; natural real-time pace, normal "
        f"speed — NOT slow motion; candid behaviour with live secondary motion. "
        + (f"This shot exists to {why}; move the camera for that. " if why else "")
        + f"{_intent(scene)}{audio} "
        # Same hierarchy as the still: the source frame's identity is the thing that must not
        # drift as it moves — face, build, hair, skin — with wardrobe and grade held after it.
        f"Hold the identity from the source image above all — same face, build, hair and skin — "
        f"and keep its wardrobe and film-style grade."
    ).strip()


# ---- the backstop ----------------------------------------------------------

def _lead(style: str, prompt: str) -> str:
    """Every prompt in the bible opens with the film's look.

    A synthesizer-written prompt that forgot the style block would render one asset off-look
    from everything around it, and the director would have no way to see that coming from
    reading the prompt.
    """
    p = (prompt or "").strip()
    if not p:
        return ""
    return p if style and style in p else f"{style}. {p}".strip(". ")


def ensure_prompts(plan: dict, style: str) -> dict:
    """Fill in every prompt synthesis left blank, in place.

    Called once, at the end of synthesis, before the bible is written to the graph. After
    this returns, every character, every location and every generation unit in the plan
    carries a complete prompt — so the three generation stages can be pure execution and a
    partial synthesis degrades into a composed prompt instead of a unit that cannot run.
    """
    for c in plan.get("characters", []):
        # dna is derived from the structured layers so it can never drift from them; a plan
        # that predates the layers keeps whatever compact dna it shipped.
        derived = character_dna(c.get("identity"), c.get("wardrobe", ""), c.get("bearing", ""))
        if derived:
            c["dna"] = derived
        # The sheet is composed, not authored: a fixed studio contract plus this character's
        # identity, so every founding sheet shares one backdrop and one composition. The
        # director still approves — and may note-edit — the composed prompt at the sheets gate.
        c["sheet_prompt"] = sheet_prompt(style, c.get("dna", ""))

    dna = {c["id"]: c.get("dna", "") for c in plan.get("characters", [])}
    envs = {e["id"]: e.get("desc", "") for e in plan.get("environments", [])}

    for e in plan.get("environments", []):
        e["plate_prompt"] = (_lead(style, e.get("plate_prompt"))
                             or plate_prompt(style, e.get("desc", "")))

    for s in plan.get("scenes", []):
        scene_cast = s.get("character_ids", [])
        env = envs.get(s.get("environment_id"), "")
        for u in s.get("coverage", []):
            # Each unit is composed against only the characters actually in THAT frame. A solo
            # close-up must not carry the rest of the scene's cast into its prompt — that is the
            # same drift the reference sheets exist to stop, reintroduced one layer up. A unit
            # with no cast list (character_ids is None) inherits the whole scene; an explicit
            # empty list is a frame with nobody in it, e.g. a detail insert.
            unit_cast = u.get("character_ids")
            cast = scene_cast if unit_cast is None else unit_cast
            blocks = [dna[cid] for cid in cast if cid in dna]
            u["keyframe_prompt"] = (_lead(style, u.get("keyframe_prompt"))
                                    or keyframe_prompt(style, s, blocks, env, u))
            u["video_prompt"] = (_lead(style, u.get("video_prompt"))
                                 or video_prompt(style, s, blocks, env, u))
    return plan


_NOTE_RE = re.compile(r"\s*Director's note:.*$", re.S)


def with_note(prompt: str, note: str | None) -> str:
    """A director's note, folded into the prompt it changes.

    The note rewrites the stored prompt rather than decorating the call, so the prompt panel
    always shows what actually made the frame. A second note replaces the first instead of
    stacking, because two contradictory notes in one prompt is how a re-render comes back
    worse than the take it replaced.
    """
    base = _NOTE_RE.sub("", prompt or "").strip()
    return f"{base} Director's note: {note}".strip() if note else base
