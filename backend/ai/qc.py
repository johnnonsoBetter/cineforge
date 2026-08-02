"""QC — the review agent.

QC is not a label written onto a node after the fact. It is an agent with its own inputs
(the pixels that came back, the pixels they were supposed to match, and the intent they
were generated from), its own structured output, and its own bounded authority to spend
the regeneration budget.

Everything QC-shaped lives in this module:

* **what gets checked**, per asset kind — a character sheet, an environment plate, a
  keyframe and a clip fail in completely different ways, so they get different checklists;
* **what the judge is shown** — the generated frames *and* the locked reference sheets it
  is supposed to match, as images. Identity drift is a visual comparison; describing the
  character in words and hoping is how drift gets waved through;
* **how a clip becomes lookable** — a video is sampled into frames across its duration, so
  the gate catches identity morphing mid-shot rather than judging its first frame twice;
* **how findings roll up** — per-criterion checks become one verdict, with the critical
  criteria (identity, continuity) able to fail the whole asset on their own;
* **what the gate does about it** — only a hard FAIL is worth paying to re-render.

The gate is deliberately coarse (qc_gate.md): it exists to catch the frames that are
*wrong*, not to chase the last 5% of taste. Taste is the director's note.
"""
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from ..config import get_config
from ..models import Asset, NodeKind, QCCheck, QCReference, QCReport
from ..pipeline import genblaze_client as gb, storage

cfg = get_config()

# ---------------------------------------------------------------------------
# What each kind of asset is checked for.
# ---------------------------------------------------------------------------
# Keyed by node kind so the checklist travels with the asset rather than being re-decided
# at each call site. `CRITICAL` criteria fail the whole asset on their own — they are the
# ones whose failure poisons everything generated downstream.

CRITERIA: dict[NodeKind, list[str]] = {
    # A reference sheet has nothing to be compared against — it *is* the reference. So it
    # is judged against the brief that specified it, and against its own fitness for the
    # job: if this frame is wrong, every frame made from it inherits the mistake.
    NodeKind.CHARACTER: ["brief", "plate", "style", "integrity"],
    NodeKind.ENVIRONMENT: ["brief", "emptiness", "style", "integrity"],
    NodeKind.KEYFRAME: ["identity", "environment", "framing", "style", "integrity"],
    NodeKind.SHOT: ["identity", "continuity", "motion", "integrity"],
}

CRITICAL = {"identity", "continuity", "brief"}

DESCRIPTIONS = {
    "brief": "every detail the written description specifies — age, build, hair, wardrobe, "
             "architecture, props — is actually present and correct in the frame",
    "identity": "the person(s) in frame are the same character(s) as the reference sheet — "
                "same face, build, hair and wardrobe. Judge the face first",
    "environment": "the location matches the environment plate and the written description",
    "framing": "the requested shot size and angle were honoured, the subject sits off-centre "
               "with a foreground layer for depth. Flat frontal group-photo framing FAILS",
    "style": "grade, lens character and lighting match the film's locked style",
    "integrity": "no mangled hands, extra limbs, warped faces, garbled text or obvious "
                 "generation artefacts",
    "plate": "a single subject on a clean neutral background, whole figure legible — this "
             "frame's job is to be a reusable identity reference",
    "emptiness": "no people and no readable text — an establishing plate must stay castable",
    "continuity": "this is the master frame re-framed, not a different moment: the location, "
                  "cast, wardrobe, props and lighting match the reference, and hold steady "
                  "across the sampled frames. Only the camera position may differ",
    "motion": "continuous real-time movement at normal speed. Slow motion, a frozen frame, "
              "a hard cut mid-clip, or a subject morphing between frames all FAIL",
}

# Human labels — the UI shows the same vocabulary the judge was given.
LABELS = {
    "brief": "Brief", "identity": "Identity", "environment": "Location",
    "framing": "Framing", "style": "Style", "integrity": "Integrity",
    "plate": "Reference plate", "emptiness": "Unpopulated",
    "continuity": "Continuity", "motion": "Motion",
}

_SYSTEM = """You are the QC gate of a film studio. You are shown the GENERATED frames of one
asset, then the REFERENCE images it must match. Judge only what you can see.

Rules:
- Judge every criterion you are given, independently, and never invent one.
- ok=false only when you can point at what is wrong in the frames. "Could be better" is ok=true.
- Identity is judged by comparing faces against the reference sheet, not by reading the brief.
- score is 0..1: how confident you are the criterion holds.

Reply with JSON only:
{"checks":[{"criterion":"<name>","ok":true,"score":0.0,"note":"<=18 words"}],"summary":"<=25 words"}"""

_VIDEO_EXT = (".mp4", ".mov", ".webm", ".m4v")


@dataclass
class Target:
    """What the asset was supposed to be — the judge's brief.

    `intent` is the prose the generation was steered by; `references` are the images it is
    held against. Both are assembled from the graph by the caller, so QC never has to guess
    which character sheet a frame was meant to match.
    """
    intent: str
    references: list[QCReference] = field(default_factory=list)
    # Criteria to drop for this one asset even though its kind normally carries them. A detail
    # insert with nobody in frame has no identity to judge, so the CRITICAL identity check
    # would otherwise fail every such frame and burn the regen budget on it. The caller, which
    # knows the unit's in-frame cast, is the only place that can tell.
    skip_criteria: tuple[str, ...] = ()


# ---------------------------------------------------------------------------
# Making an asset lookable
# ---------------------------------------------------------------------------

def is_video(url: str | None) -> bool:
    return bool(url) and url.lower().split("?")[0].endswith(_VIDEO_EXT)


# Frames pulled out of a clip are kept, not thrown away: they are the evidence behind a
# verdict on a video, and the only way for anyone to check what the reviewer actually saw.
_QC_DIR = Path(cfg.DATA_DIR) / "qc"

# A report should retain the durable B2 URL, but the vision provider should read the local
# frame we just extracted. B2 buckets may be private, in which case a durable endpoint URL
# is intentionally not browser/provider-readable. This process-local reverse map lets
# ``_seeable`` inline those fresh frames without weakening the persisted evidence URL.
_QC_LOCAL_BY_URL: dict[str, Path] = {}


def _persist_frame(path: Path, asset_id: str) -> str:
    """Upload one sampled frame to B2 and return its durable evidence URL.

    The content hash makes the object idempotent across repeated reviews of the same bytes.
    When B2 is absent or unavailable, retain the existing locally served URL so QC remains
    available in development and during a storage outage.
    """
    local_url = f"/api/media/qc/{path.name}"
    try:
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        url = storage.put_bytes(f"qc/{asset_id}/{digest}.jpg", data, "image/jpeg")
    except Exception:
        url = None
    if url:
        _QC_LOCAL_BY_URL[url] = path
        return url
    return local_url


def _local_path(url: str) -> Path | None:
    """Map a URL we serve ourselves back to the file behind it."""
    uploaded = _QC_LOCAL_BY_URL.get(url)
    if uploaded is not None:
        return uploaded
    if url.startswith("/api/media/qc/"):
        return _QC_DIR / url.rsplit("/", 1)[-1]
    if url.startswith("/api/media/"):
        return Path(cfg.DATA_DIR) / "mock" / url.rsplit("/", 1)[-1]
    if not url.startswith(("http://", "https://")):
        p = Path(url)
        return p if p.exists() else None
    return None


def _data_uri(path: Path) -> str | None:
    try:
        mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
        return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"
    except Exception:
        return None


def _seeable(url: str | None) -> str | None:
    """Turn an asset URL into something a vision model can actually load.

    Remote URLs go through as-is; anything we serve locally (mock clips, a cut rendered to
    disk before B2 is wired up) is inlined as a data URI, because the model cannot reach
    back into this process to fetch it.
    """
    if not url:
        return None
    p = _local_path(url)
    if p and p.exists():
        return _data_uri(p)
    return url if url.startswith(("http://", "https://")) else None


def sample_frames(asset: Asset, n: int | None = None) -> list[str]:
    """The frames of an asset a judge should look at, as URLs.

    A still is one frame. A clip is `n` frames spread across its duration — which is the
    only way the gate can see identity morphing or a mid-clip cut, both of which are
    invisible in the poster frame the UI shows.

    Extracted frames are written once and returned as served URLs rather than inlined:
    they end up in the report, which is streamed and persisted, and they are worth keeping
    — a verdict on a clip should come with the frames it was reached from.

    Returns [] when a clip exists but cannot be sampled; the caller reports that honestly
    rather than falling back to judging the source keyframe, which would be a verdict about
    an image nobody is shipping.
    """
    if not asset or not asset.url:
        return []
    if not is_video(asset.url):
        return [asset.url]

    n = n or cfg.QC_FRAME_SAMPLES
    src = _local_path(asset.url) or asset.url
    if not shutil.which("ffmpeg"):
        return []

    duration = asset.duration_sec or 8.0
    # Avoid the very first and last frames: encoders routinely put a black or half-faded
    # frame there, and QC would fail a perfectly good clip on it.
    stamps = [duration * f for f in ([0.1, 0.5, 0.9] if n >= 3 else [0.5])][:n]
    _QC_DIR.mkdir(parents=True, exist_ok=True)
    out: list[str] = []
    for t in stamps:
        name = hashlib.sha256(f"{asset.asset_id}|{asset.url}|{t:.2f}".encode()).hexdigest()[:16] + ".jpg"
        f = _QC_DIR / name
        if not (f.exists() and f.stat().st_size):
            try:
                proc = subprocess.run(
                    ["ffmpeg", "-y", "-ss", f"{t:.2f}", "-i", str(src), "-frames:v", "1",
                     "-vf", "scale=640:-2", "-q:v", "4", str(f)],
                    capture_output=True, timeout=60)
            except Exception:
                continue
            if proc.returncode != 0 or not (f.exists() and f.stat().st_size):
                continue
        out.append(_persist_frame(f, asset.asset_id))
    return out


# ---------------------------------------------------------------------------
# Rolling findings up into a verdict
# ---------------------------------------------------------------------------

def rollup(checks: list[QCCheck]) -> str:
    """One verdict from many findings.

    A failed *critical* criterion is fatal on its own — a frame of the wrong person is not
    a frame with a problem, it is the wrong frame. Otherwise it takes two failures to be
    worth re-rendering for; a single soft miss is BORDERLINE, which we keep and flag rather
    than pay to shoot again.
    """
    bad = [c for c in checks if not c.ok]
    if any(c.criterion in CRITICAL for c in bad):
        return "FAIL"
    if len(bad) >= 2:
        return "FAIL"
    if bad:
        return "BORDERLINE"
    return "PASS"


def should_regenerate(report: QCReport) -> bool:
    """Only a hard FAIL is worth paying to render again."""
    return report.verdict == "FAIL"


def accepted(report: QCReport | None) -> bool:
    """Whether a take is good enough to build on. BORDERLINE is: keep it, but say so."""
    return report is None or report.verdict in ("PASS", "BORDERLINE", "SKIPPED")


# ---------------------------------------------------------------------------
# The review itself
# ---------------------------------------------------------------------------

def _brief(kind: NodeKind, target: Target, criteria: list[str], n_frames: int) -> str:
    refs = "\n".join(f"  REFERENCE {i + 1}: {r.label}" for i, r in enumerate(target.references))
    lines = "\n".join(f"  - {c}: {DESCRIPTIONS.get(c, c)}" for c in criteria)
    frames = (f"{n_frames} frames sampled in order across the clip"
              if kind == NodeKind.SHOT else f"{n_frames} still")
    return (f"ASSET: {kind.value} ({frames})\n"
            f"INTENT: {target.intent}\n"
            f"{'REFERENCES (shown after the generated frames):' if refs else 'REFERENCES: none'}\n"
            f"{refs}\n\nJUDGE EXACTLY THESE CRITERIA:\n{lines}")


def _parse(raw: str, criteria: list[str]) -> tuple[list[QCCheck], str]:
    """Read the judge's JSON, keeping only criteria we asked about.

    Models occasionally wrap JSON in prose or invent a criterion; both are recoverable, and
    an unparseable reply is a QC failure of the *judge*, not of the frame — so it comes back
    empty and the caller reports it as such.
    """
    try:
        blob = json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw or "", re.S)
        if not m:
            return [], ""
        try:
            blob = json.loads(m.group(0))
        except Exception:
            return [], ""

    allowed = set(criteria)
    checks = []
    for c in blob.get("checks") or []:
        name = str(c.get("criterion", "")).strip().lower()
        if name not in allowed:
            continue
        try:
            score = max(0.0, min(1.0, float(c.get("score", 0))))
        except (TypeError, ValueError):
            score = 0.0
        checks.append(QCCheck(criterion=name, ok=bool(c.get("ok", True)), score=score,
                              note=str(c.get("note", ""))[:160]))
    return checks, str(blob.get("summary", ""))[:240]


def _mock(kind: NodeKind, criteria: list[str], frames: list[str], target: Target,
          attempt: int) -> QCReport:
    """A structured stand-in with the same shape as a real review.

    Deterministically fails one attempt in five on the first pass, so the regeneration loop
    — the thing that is actually hard to demo — is visible in a keyless run instead of
    every frame sailing through.
    """
    seed = abs(hash((frames[0] if frames else "", kind.value)))
    dud = criteria[0] if (attempt == 0 and seed % 5 == 0) else None
    checks = [
        QCCheck(criterion=c, ok=c != dud, score=0.42 if c == dud else 0.88 + (seed % 10) / 100,
                note=("drifts from the locked reference" if c == dud
                      else f"{LABELS.get(c, c).lower()} holds"))
        for c in criteria
    ]
    return QCReport(
        verdict=rollup(checks),
        summary=("identity drift against the reference sheet — re-rendering with the "
                 "reference re-injected" if dud else "matches the reference and the brief"),
        checks=checks, criteria=criteria, frames=frames, references=target.references,
        attempt=attempt, source="mock", model=None)


def review(kind: NodeKind, asset: Asset, target: Target, *, attempt: int = 0) -> QCReport:
    """Look at an asset and file a report. The one entry point to the gate."""
    criteria = [c for c in CRITERIA.get(kind, ["style", "integrity"])
                if c not in target.skip_criteria]
    frames = sample_frames(asset)

    if not frames:
        why = ("the clip could not be sampled (ffmpeg unavailable or unreadable)"
               if is_video(asset.url if asset else None) else "no image was produced")
        return QCReport(verdict="SKIPPED", summary=f"Not reviewed — {why}.",
                        criteria=criteria, references=target.references,
                        attempt=attempt, source="unavailable")

    # Placeholder pixels carry no information about the real thing, and a text-only model
    # cannot look at pixels at all. Both cases mock rather than rubber-stamp.
    if cfg.mock_media() or not cfg.can_see():
        return _mock(kind, criteria, frames, target, attempt)

    # Anything we host ourselves is inlined at the last moment — the model cannot reach
    # back into this process to fetch it, and the report should keep the short URL.
    seen = [u for u in (_seeable(f) for f in frames) if u]
    ref_urls = [u for u in (_seeable(r.url) for r in target.references) if u]
    if not seen:
        return QCReport(verdict="SKIPPED", summary="The frames could not be read for review.",
                        criteria=criteria, frames=frames, references=target.references,
                        attempt=attempt, source="unavailable")
    try:
        raw = gb.chat(_SYSTEM, _brief(kind, target, criteria, len(seen)),
                      image_urls=seen + ref_urls, json_mode=True, temperature=0,
                      model=cfg.QC_MODEL)
    except Exception as e:
        return QCReport(verdict="SKIPPED", summary=f"Review unavailable ({type(e).__name__}).",
                        criteria=criteria, frames=frames, references=target.references,
                        attempt=attempt, source="error", model=cfg.QC_MODEL)

    checks, summary = _parse(raw, criteria)
    if not checks:
        return QCReport(verdict="SKIPPED", summary="The reviewer returned nothing readable.",
                        criteria=criteria, frames=frames, references=target.references,
                        attempt=attempt, source="error", model=cfg.QC_MODEL)

    return QCReport(verdict=rollup(checks), summary=summary or "reviewed",
                    checks=checks, criteria=criteria, frames=frames,
                    references=target.references, attempt=attempt,
                    source="vision", model=cfg.QC_MODEL)


def error_report(what: str, exc: Exception) -> QCReport:
    """A generation that never produced pixels, expressed in the same shape.

    The canvas reads one QC field per node; a failed render has to speak that language too,
    otherwise the failure is the only thing on the card with nowhere to be shown.
    """
    return QCReport(verdict="ERROR", source="error",
                    summary=f"{what} failed: {type(exc).__name__}: {exc}"[:240])


def ledger(project) -> dict:
    """Every verdict in the film, counted.

    The gate's own record: what was reviewed, what it cost in re-renders, and what is still
    waiting on a human. This is the number that answers "is this production-ready?" — and
    unlike a confidence score, every part of it is a thing you can click through to.
    """
    reviewed = [n for n in project.nodes if n.qc]
    by_verdict: dict[str, int] = {}
    for n in reviewed:
        by_verdict[n.qc.verdict] = by_verdict.get(n.qc.verdict, 0) + 1

    failing: dict[str, int] = {}
    for n in reviewed:
        for c in n.qc.failed():
            failing[c.criterion] = failing.get(c.criterion, 0) + 1

    passed = by_verdict.get("PASS", 0)
    return {
        "reviewed": len(reviewed),
        "passed": passed,
        "verdicts": by_verdict,
        "pass_rate": round(passed / len(reviewed), 3) if reviewed else None,
        "regens_spent": sum(n.attempt for n in reviewed),
        "failing_criteria": dict(sorted(failing.items(), key=lambda kv: -kv[1])),
        # Anything the gate could not sign off on and no one has looked at, named — a
        # summary that hides the exceptions is the summary nobody should ship on.
        "needs_a_human": [
            {"node_id": n.node_id, "title": n.title, "kind": n.kind.value,
             "verdict": n.qc.verdict, "summary": n.qc.summary}
            for n in reviewed if not accepted(n.qc) and not n.data.get("qc_override")
        ],
        "overruled": sum(1 for n in reviewed if n.data.get("qc_override")),
        "unreviewed": [n.node_id for n in project.nodes
                       if n.asset and not n.qc],
        "sighted": not (cfg.mock_media() or not cfg.can_see()),
    }


def headline(report: QCReport) -> str:
    """One line for the conversation panel — the reviewer's own voice in the run."""
    if report.verdict == "PASS":
        return "Reviewed — clean."
    if report.verdict == "SKIPPED":
        return report.summary
    bad = ", ".join(LABELS.get(c.criterion, c.criterion).lower() for c in report.failed())
    return f"Reviewed — {report.verdict.lower()} on {bad}." if bad else f"Reviewed — {report.verdict.lower()}."
