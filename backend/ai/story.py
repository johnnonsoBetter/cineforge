"""The synthesizer — the one creative pass. brief -> the whole film bible.

Returns the structured dict the rest of the pipeline consumes: style, cast, locations, the
scene breakdown, and — front-loaded here rather than composed later — every prompt the three
generation passes will spend. That is what makes the passes after this one mechanical, and
what makes the first gate the one worth standing at: the director approves the prompts, not
just the story.

Real mode asks an LLM for JSON; mock mode returns a believable, on-theme breakdown so the
whole flow demos with no keys. The mock deliberately writes no prompts at all, so every
keyless run exercises `camera.ensure_prompts` — the backstop that has to hold when a real
synthesis comes back short.
"""
from __future__ import annotations
import json
import re
from ..config import get_config
from ..pipeline import genblaze_client as gb
from . import camera

cfg = get_config()

_SYSTEM = """You are a film creative director. Given a one-line idea, return STRICT JSON:
{
 "title": str,
 "style": "one-line visual style block",
 "bible": {"theme": str, "genre": str, "mood": str, "conflict": str,
           "resolution": str, "symbolism": str},
 "beats": [{"name": "Opening|Inciting Incident|Rising Action|Climax|Ending", "text": str}],
 "characters": [{"id": "SNAKE_CASE", "name": str,
                 "identity": {"ethnicity": str, "gender": "man|woman|...", "age": "e.g. early 40s",
                              "build": str, "skin": str, "hair": str, "eyes": str,
                              "features": "distinguishing marks: facial hair, scars, glasses"},
                 "wardrobe": "the founding costume this character wears on their reference sheet",
                 "bearing": "posture and demeanour in one phrase"}],
 "environments": [{"id": "SNAKE_CASE", "name": str, "desc": str,
                   "plate_prompt": "prompt for this location's empty establishing plate"}],
 "scenes": [{"n": int, "title": str, "action": str, "environment_id": str,
             "character_ids": [str], "shot": str, "angle": str, "move": str,
             "time": str, "atmosphere": str, "vo": "one spoken line or empty",
             "intent": "reveal character|raise tension|comedy|emotional payoff|establish world",
             "coverage": [{"shot": "wide shot|medium shot|medium two-shot|close-up|
                                    over-the-shoulder|insert", "angle": "low angle|eye level|
                                    high angle|dutch angle", "move": "how the camera moves",
                           "action": "what happens on screen in this shot",
                           "intent": "why this angle earns its place",
                           "character_ids": ["ONLY the characters actually visible in THIS "
                                             "setup", "[] for a detail insert of an object"],
                           "keyframe_prompt": "prompt for this unit's still",
                           "video_prompt": "prompt animating that still"}]}]
}
COVERAGE is how you would shoot the scene: the same moment, filmed from several camera
setups. The scene's own "shot"/"angle" describe how the scene is staged; each coverage entry
re-frames that same moment — same place, same cast, same wardrobe, same lighting — from a
different distance or angle. Never write a coverage entry that moves the story forward; that
is a new scene, not a new shot.
Give each scene ONLY the coverage it earns: 1 for a simple beat, 2-3 when a scene turns on
a reaction or a reveal, 4 at the very most. Vary it — a film where every scene is covered
identically is a film nobody shot.
For each setup, character_ids names ONLY the cast actually in that frame: a close-up of one
person names that one, a two-shot names both, a detail insert of a prop or a list names
nobody ([]). Every id must be one of the scene's character_ids. This is what keeps a solo
close-up from being built against the whole scene's faces.

EACH COVERAGE ENTRY IS ONE GENERATION UNIT: one still, then one 8-second clip animated from
that exact still. So write both of its prompts, and write them as a pair — the video prompt
animates the frame the keyframe prompt describes, and must not introduce anything that frame
does not contain.

PROMPTS. You are writing the prompts the pipeline will actually send; nothing downstream
rewrites them. Every one of them:
 - opens with the film's style block, verbatim;
 - is self-contained — an image model sees only this prompt, not the screenplay;
 - names wardrobe, light and time of day explicitly, because that is what keeps two units of
   the same scene looking like the same scene;
 - never refers to another shot, another prompt, or "as before".
Keyframe prompts describe a single frame. Video prompts describe motion over 8 seconds at
natural real-time pace — never slow motion — and treat the source image as the first frame.

CHARACTERS. Do NOT write a character sheet prompt — the pipeline composes each sheet from the
identity fields on a fixed studio backdrop, so every character in the film shares one look and
one background. Your job is to fill those fields precisely; they are what every frame of that
character is built from. Split each character in two: IDENTITY is permanent physical truth
(ethnicity, gender, age, build, skin, hair, eyes, distinguishing features) — the hard identity
lock every frame of that character must match; WARDROBE is the costume they wear, held
consistent across the whole film. Keep clothing out of identity and body out of wardrobe.

Give a real spine: want, obstacle, escalation (therefore/but), a turn, a button.
Write exactly the number of scenes the brief asks for, in the language the brief specifies.
The beat sheet must describe the same film as the scenes, not a different one.
Every scene needs an intent — what it is FOR. A scene with no intent should be cut.
Dialogue in each character's distinct voice, with subtext. No prose outside the JSON."""

# The film's spine, as fields. Kept here so the mock, the normalizer and the inspector
# can't drift apart on what a story bible contains.
BIBLE_FIELDS = ("theme", "genre", "mood", "conflict", "resolution", "symbolism")

BEAT_ORDER = ("Opening", "Inciting Incident", "Rising Action", "Climax", "Ending")

# Style presets. The preset leads the style block and the model's own style line follows it,
# so an explicit user choice can't be quietly overruled by whatever the LLM felt like.
STYLE_PRESETS = {
    "cinematic": "cinematic live action, filmic color grade, shallow depth of field, natural light",
    "pixar": "Pixar-style 3D animation, soft global illumination, expressive stylised characters",
    "anime": "modern anime, cel shading, crisp linework, dramatic key light",
    "ghibli": "Studio Ghibli-style hand-painted animation, soft watercolour skies, warm naturalism",
    "photorealistic": "photorealistic, 35mm, physically accurate light, fine skin and fabric detail",
}


def style_block(preset: str, llm_style: str = "") -> str:
    """The film's look: the chosen preset, then whatever the story agent added on top."""
    base = STYLE_PRESETS.get((preset or "").lower(), STYLE_PRESETS["cinematic"])
    return f"{base}. {llm_style}".strip().rstrip(".") if llm_style.strip() else base


def _mock(idea: str, target: int = 4) -> dict:
    plan = {
        "title": "The VIP Treatment",
        "style": "warm cinematic Nollywood comedy, saturated golden light, shallow depth of field",
        "bible": {
            "theme": "Status is something other people grant you, never something you announce.",
            "genre": "Comedy of manners",
            "mood": "Warm, festive, quietly humiliating",
            "conflict": "A man who needs to be seen as important meets a woman who is paid not to care.",
            "resolution": "He gets a seat, just not the one he came for — and finds he can live with it.",
            "symbolism": "The VIP rope: a line drawn in cloth that everyone agrees to believe in.",
        },
        # Plain names here, not tokens: tokenize_plan converts them on the way in, and
        # pre-tokenised text would be tokenised a second time into nonsense.
        "beats": [
            {"name": "Opening", "text": "Simeon arrives dressed for the version of himself he wants to be."},
            {"name": "Inciting Incident", "text": "The Usher cannot find his name on the list."},
            {"name": "Rising Action", "text": "He escalates — charm, then names, then pleading."},
            {"name": "Climax", "text": "He is offered the last seat at the back, by the speakers."},
            {"name": "Ending", "text": "He takes it, and starts nodding to the beat."},
        ],
        # Split into layers, no flat dna: the keyless path derives dna in camera.ensure_prompts,
        # so the sample exercises exactly the composition a real synthesis goes through.
        "characters": [
            {"id": "SIMEON", "name": "Simeon",
             "identity": {"ethnicity": "Nigerian", "gender": "man", "age": "late 30s",
                          "build": "average build", "skin": "warm brown skin",
                          "hair": "close-cropped black hair", "eyes": "dark brown eyes",
                          "features": "round face, thin moustache"},
             "wardrobe": "shiny burgundy agbada with gold wristwatch",
             "bearing": "confident swagger, expects to be recognised"},
            {"id": "USHER", "name": "The Usher",
             "identity": {"ethnicity": "Nigerian", "gender": "woman", "age": "mid 20s",
                          "build": "tall, slim", "skin": "deep brown skin",
                          "hair": "hair wrapped in a gele", "eyes": "dark eyes",
                          "features": "calm, even features"},
             "wardrobe": "teal aso-ebi wrapper and gele, holds a clipboard",
             "bearing": "polite but immovable"},
        ],
        "environments": [
            {"id": "HALL", "name": "Wedding Hall", "desc": "grand owambe hall, chandeliers, round tables, live band on a low stage"},
            {"id": "GATE", "name": "Entrance", "desc": "decorated entrance arch with flowers and a red carpet strip"},
        ],
        "scenes": [
            {"n": 1, "title": "Grand Arrival", "action": "Simeon strides in adjusting his agbada, expecting applause",
             "environment_id": "GATE", "character_ids": ["SIMEON"], "shot": "wide shot", "angle": "low angle",
             "move": "slow push-in", "time": "evening", "atmosphere": "festive, expectant",
             "vo": "They have been waiting for me.", "intent": "establish world",
             # One setup: the joke is the emptiness around him, and cutting would break it.
             "coverage": [
                 {"shot": "wide shot", "angle": "low angle", "move": "slow push-in",
                  "action": "Simeon steps through the arch, arms spread, chin high, waiting for a reaction that never comes",
                  "intent": "let the empty carpet do the work", "character_ids": ["SIMEON"]}]},
            {"n": 2, "title": "The Checkpoint", "action": "The usher blocks him, scanning her clipboard, unimpressed",
             "environment_id": "GATE", "character_ids": ["SIMEON", "USHER"], "shot": "medium two-shot", "angle": "eye level",
             "move": "locked camera", "time": "evening", "atmosphere": "tense, comic",
             "vo": "Sir, your name is not on the VIP list.", "intent": "raise tension",
             # Three: the block, the line that lands it, and the face that receives it.
             "coverage": [
                 {"shot": "medium two-shot", "angle": "eye level", "move": "locked camera",
                  "action": "The Usher raises a flat hand, clipboard up; Simeon is still smiling",
                  "intent": "hold both of them in one frame", "character_ids": ["SIMEON", "USHER"]},
                 {"shot": "insert", "angle": "high angle", "move": "slow tilt down",
                  "action": "her finger stops halfway down a list his name is not on",
                  "intent": "show the verdict, not the reaction", "character_ids": []},
                 {"shot": "close-up", "angle": "eye level", "move": "locked camera",
                  "action": "Simeon's smile stays exactly where it was, and stops meaning anything",
                  "intent": "the punchline is on his face", "character_ids": ["SIMEON"]}]},
            {"n": 3, "title": "Negotiation", "action": "Simeon bargains, name-drops, sweats; the usher does not blink",
             "environment_id": "HALL", "character_ids": ["SIMEON", "USHER"], "shot": "close-up", "angle": "slight high angle",
             "move": "handheld drift", "time": "evening", "atmosphere": "desperate, funny",
             "vo": "Do you know who I am?", "intent": "comedy",
             # Two: the pitch and the wall it hits.
             "coverage": [
                 {"shot": "over-the-shoulder", "angle": "slight high angle", "move": "handheld drift in",
                  "action": "past the usher's shoulder, Simeon leans in, palms pressed together, whispering a name",
                  "intent": "put us behind the person he has to convince", "character_ids": ["SIMEON", "USHER"]},
                 {"shot": "close-up", "angle": "eye level", "move": "locked camera",
                  "action": "the usher's expression does not move at all",
                  "intent": "the wall, in one frame", "character_ids": ["USHER"]}]},
            {"n": 4, "title": "The Button", "action": "He is seated at the very back by the speakers, defeated but nodding to the beat",
             "environment_id": "HALL", "character_ids": ["SIMEON"], "shot": "wide shot", "angle": "high angle",
             "move": "slow pull-back", "time": "night", "atmosphere": "bittersweet, warm",
             "vo": "VIP... very important position. Near the music.", "intent": "emotional payoff",
             # Two: the private moment, then the room that swallows it.
             "coverage": [
                 {"shot": "medium shot", "angle": "eye level", "move": "locked camera",
                  "action": "Simeon lowers himself into the last chair, right beside a speaker stack",
                  "intent": "stay with him while he decides how to take it", "character_ids": ["SIMEON"]},
                 {"shot": "wide shot", "angle": "high angle", "move": "slow pull-back",
                  "action": "he is settled, nodding to the beat, small in a wide warm room",
                  "intent": "end on the scale of the room", "character_ids": ["SIMEON"]}]},
        ],
    }

    # The sample is four scenes long; a longer runtime cycles it so the requested length
    # still flows through the whole pipeline. It reads as a repeat because it is one — the
    # UI badges this path "Story · sample" precisely so nobody mistakes it for a screenplay.
    base = plan["scenes"]
    if target != len(base):
        plan["scenes"] = [{**base[i % len(base)], "n": i + 1} for i in range(target)]
    return plan


def _extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(m.group(0)) if m else {}


def _slug(s: str, fallback: str) -> str:
    out = re.sub(r"[^A-Za-z0-9]+", "_", str(s or "")).strip("_").upper()
    return out or fallback


def _identity(raw) -> dict:
    """Fixed identity keys, always present — a character's permanent physical layer. Keying off
    camera.IDENTITY_FIELDS keeps this and the dna composer from disagreeing on what the layer is."""
    src = raw if isinstance(raw, dict) else {}
    return {k: str(src.get(k) or "").strip() for k in camera.IDENTITY_FIELDS}


def _normalize_bible(raw) -> dict:
    """Fixed keys, always present. A half-filled bible renders as a half-empty panel, which
    is better than the inspector having to guess which fields exist."""
    src = raw if isinstance(raw, dict) else {}
    return {k: str(src.get(k) or "").strip() for k in BIBLE_FIELDS}


def _normalize_beats(raw) -> list[dict]:
    """Beats come back as dicts, or as bare strings, or as a dict keyed by beat name —
    all three are common. Accept them all; order by the arc, not by what the model emitted."""
    out: list[dict] = []
    if isinstance(raw, dict):
        raw = [{"name": k, "text": v} for k, v in raw.items()]
    for b in raw or []:
        if isinstance(b, dict):
            name, text = str(b.get("name") or b.get("beat") or ""), str(b.get("text") or "")
        elif isinstance(b, str):
            name, text = "", b
        else:
            continue
        if name.strip() or text.strip():
            out.append({"name": name.strip(), "text": text.strip()})

    known = {n.lower(): i for i, n in enumerate(BEAT_ORDER)}
    out.sort(key=lambda b: known.get(b["name"].lower(), len(BEAT_ORDER)))
    return out


MAX_COVERAGE = 4   # past this a "scene" is really two scenes wearing one coat


def _normalize_coverage(raw, scene: dict) -> list[dict]:
    """A scene's shot list — however many setups the scene earned, capped at MAX_COVERAGE.

    The count is the scene's to decide, not a setting's: an establishing beat is one setup
    and a confrontation is three, and forcing both to the same number is how films end up
    looking machine-cut. What is guaranteed is that every scene has *at least* one shot —
    a scene nobody filmed is a scene that isn't in the film.

    Anything the model left blank falls back to the scene's own master framing, so a sparse
    entry still describes a shootable setup.
    """
    scene_cast = scene.get("character_ids") or []

    def unit_cast(raw_ids):
        """A unit's in-frame cast, resolved against the scene's cast. None (the key is absent)
        means 'inherit the whole scene' — the safe default, and what every pre-existing plan
        gets. An explicit list, even an empty one, is honoured: [] is a frame with nobody in
        it, so a detail insert can say so and not be built against the scene's faces."""
        if not isinstance(raw_ids, list):
            return None
        out_ids: list[str] = []
        for ref in raw_ids:
            s = _slug(ref, "")
            if not s:
                continue
            if s in scene_cast:
                out_ids.append(s)
            else:  # loose ref, same containment fallback resolve_char uses for the scene cast
                hit = next((c for c in scene_cast if s in c or c in s), None)
                if hit:
                    out_ids.append(hit)
        return list(dict.fromkeys(out_ids))

    blank = {"shot": "", "angle": "", "move": "", "action": "", "intent": "",
             "character_ids": None, "keyframe_prompt": "", "video_prompt": ""}
    out: list[dict] = []
    for c in raw or []:
        if isinstance(c, dict):
            # The two prompts come through as written. Anything missing is filled by
            # camera.ensure_prompts once the film's style block is settled, which is later
            # than here — a prompt without the style block in front of it is not usable.
            out.append({"shot": str(c.get("shot") or "").strip(),
                        "angle": str(c.get("angle") or "").strip(),
                        "move": str(c.get("move") or "").strip(),
                        "action": str(c.get("action") or c.get("text") or "").strip(),
                        "intent": str(c.get("intent") or "").strip(),
                        "character_ids": unit_cast(c.get("character_ids")),
                        "keyframe_prompt": str(c.get("keyframe_prompt") or "").strip(),
                        "video_prompt": str(c.get("video_prompt") or "").strip()})
        elif isinstance(c, str) and c.strip():
            out.append({**blank, "action": c.strip()})

    out = out[:MAX_COVERAGE]
    if not out:
        # No coverage written: shoot the scene as one unit staged the way the scene is.
        # One honest setup beats inventing angles the story agent never asked for.
        out = [dict(blank)]

    for c in out:
        c["shot"] = c["shot"] or scene.get("shot", "medium shot")
        c["angle"] = c["angle"] or scene.get("angle", "eye level")
        c["move"] = c["move"] or scene.get("move", "locked camera")
        c["action"] = c["action"] or scene.get("action", "")
    return out


def _normalize(data: dict, idea: str) -> dict:
    """Repair the shapes an LLM commonly gets slightly wrong.

    The director indexes characters/environments by id and renders scenes in order, so a
    missing id or a dangling reference would quietly drop nodes off the canvas. Everything
    here is defensive: coerce, de-duplicate, renumber, and drop references that don't resolve.
    """
    chars, seen = [], set()
    for i, c in enumerate(data.get("characters") or []):
        if not isinstance(c, dict):
            continue
        cid = _slug(c.get("id") or c.get("name"), f"CHAR_{i+1}")
        while cid in seen:
            cid += "_2"
        seen.add(cid)
        chars.append({"id": cid, "name": str(c.get("name") or cid.title()),
                      "identity": _identity(c.get("identity")),
                      "wardrobe": str(c.get("wardrobe") or "").strip(),
                      "bearing": str(c.get("bearing") or "").strip(),
                      # Back-compat: a model that still writes a flat dna keeps it as the
                      # fallback label; camera.ensure_prompts derives dna from the identity
                      # layer when the layer is filled, which is the normal path.
                      "dna": str(c.get("dna") or c.get("description") or "").strip()})

    envs, seen_e = [], set()
    for i, e in enumerate(data.get("environments") or []):
        if not isinstance(e, dict):
            continue
        eid = _slug(e.get("id") or e.get("name"), f"ENV_{i+1}")
        while eid in seen_e:
            eid += "_2"
        seen_e.add(eid)
        envs.append({"id": eid, "name": str(e.get("name") or eid.title()),
                     "desc": str(e.get("desc") or e.get("description") or ""),
                     "plate_prompt": str(e.get("plate_prompt") or "").strip()})

    char_ids = {c["id"] for c in chars}
    env_ids = {e["id"] for e in envs}
    default_env = envs[0]["id"] if envs else None

    def resolve_char(ref: str) -> str | None:
        """Scenes often name a character loosely ('IMANI' for 'DR_IMANI'). Match exactly
        first, then by name, then by containment — a dropped ref means a cast member
        silently vanishes from the frame, which is worse than a slightly fuzzy match."""
        if ref in char_ids:
            return ref
        for c in chars:
            if _slug(c["name"], "") == ref:
                return c["id"]
        hits = [c["id"] for c in chars if ref in c["id"] or c["id"] in ref]
        return hits[0] if len(hits) == 1 else None

    scenes: list[dict] = []
    for i, s in enumerate(data.get("scenes") or []):
        if not isinstance(s, dict):
            continue
        scene_out: dict = {}
        env_id = _slug(s.get("environment_id"), "") or None
        if env_id not in env_ids:
            env_id = default_env
        cids = [resolve_char(_slug(c, "")) for c in (s.get("character_ids") or []) if _slug(c, "")]
        cids = list(dict.fromkeys([c for c in cids if c]))  # drop misses, keep order, de-dupe
        scene_out.update({
            "n": i + 1,                                   # renumber: order is what matters
            "title": str(s.get("title") or f"Scene {i+1}"),
            "action": str(s.get("action") or ""),
            "environment_id": env_id,
            "character_ids": cids,
            "shot": str(s.get("shot") or "medium shot"),
            "angle": str(s.get("angle") or "eye level"),
            "move": str(s.get("move") or "locked camera"),
            "time": str(s.get("time") or "day"),
            "atmosphere": str(s.get("atmosphere") or ""),
            "vo": str(s.get("vo") or ""),
            "intent": str(s.get("intent") or s.get("purpose") or ""),
        })
        # Coverage reads from the finished scene, so a sparse entry inherits the normalised
        # master framing rather than whatever the model originally sent.
        scene_out["coverage"] = _normalize_coverage(
            s.get("coverage") or s.get("shots"), scene_out)
        scenes.append(scene_out)

    if not scenes or not chars:
        raise ValueError("plan missing scenes or characters")

    return {
        "title": str(data.get("title") or "Untitled Film"),
        "style": str(data.get("style") or "cinematic, filmic color, shallow depth of field"),
        "bible": _normalize_bible(data.get("bible")),
        "beats": _normalize_beats(data.get("beats")),
        "characters": chars,
        "environments": envs,
        "scenes": scenes,
        "_source": "llm",
    }


def plan_stream(idea: str, settings=None):
    """Idea + production settings -> structured film plan, streamed.

    The one source of truth for how a plan is built and normalized. It is a generator: while
    the LLM writes, it yields the running character count of the synthesis so far (a heartbeat
    the director turns into a climbing bar), and returns the finished, normalized plan as the
    generator's value (PEP 380). `plan()` is the blocking drain of this for callers that don't
    want the heartbeat.

    Real whenever an LLM key exists (text is cents), regardless of MOCK_MODE — that's what
    makes an arbitrary idea produce an actual bespoke screenplay instead of the sample.
    """
    target = settings.target_scenes() if settings else 4
    language = getattr(settings, "language", None) or "English"
    preset = getattr(settings, "style_preset", None) or "cinematic"
    shots = settings.target_shots() if settings else 8

    if not cfg.mock_text():
        # The shot budget is given as a total, not a per-scene quota: that is what lets the
        # agent spend three setups on the scene that turns and one on the scene that doesn't,
        # while the film still comes out near the runtime that was asked for.
        brief = (f"IDEA: {idea}\n"
                 f"SCENES: exactly {target}\n"
                 f"TOTAL SHOTS ACROSS THE FILM: about {shots} — distribute them across the "
                 f"scenes as each scene warrants (1 to {MAX_COVERAGE} each), not evenly\n"
                 f"DIALOGUE LANGUAGE: {language} — write every spoken line in it\n"
                 f"VISUAL IDIOM: {STYLE_PRESETS.get(preset.lower(), preset)}")
        raw = ""
        try:
            total = 0
            parts: list[str] = []
            for delta in gb.chat_stream(_SYSTEM, brief, json_mode=True, temperature=0.9):
                parts.append(delta)
                total += len(delta)
                yield total
            raw = "".join(parts)
        except Exception:
            raw = ""  # streaming wire error — fall back to the blocking call below
        if not raw.strip():
            # Streaming produced nothing (a provider that rejects stream+json_object, a
            # transient error). The blocking path is the one we know the provider accepts, so
            # try it once before giving up on a bespoke screenplay for the sample.
            try:
                raw = gb.chat(_SYSTEM, brief, json_mode=True, temperature=0.9)
            except Exception:
                raw = ""
        if raw.strip():
            try:
                return _normalize(_extract_json(raw), idea)
            except Exception:
                pass  # malformed/short synthesis — graceful fallback keeps the demo alive
    out = _mock(idea, target)
    # The sample ships its coverage hand-written per scene; run it through the same
    # normalizer so both paths produce exactly the same shape.
    for s in out["scenes"]:
        s["coverage"] = _normalize_coverage(s.get("coverage"), s)
    out["_source"] = "sample"
    return out


def plan(idea: str, settings=None) -> dict:
    """Blocking drain of `plan_stream` — the film plan without the streaming heartbeat."""
    gen = plan_stream(idea, settings)
    try:
        while True:
            next(gen)
    except StopIteration as done:
        return done.value
