"""Provenance helpers — turn a Genblaze manifest into the summary we persist + show in the
canvas provenance drawer. In MOCK_MODE we synthesize a believable manifest."""
from __future__ import annotations
import hashlib
import json
from ..models import Provenance


def summarize_manifest(manifest, prompt: str | None = None) -> Provenance:
    """Extract a Provenance summary from a real Genblaze manifest object."""
    def g(obj, *names):
        for n in names:
            v = getattr(obj, n, None)
            if v is not None:
                return v
        return None

    verified = None
    try:
        verified = bool(manifest.verify())
    except Exception:
        verified = None

    return Provenance(
        manifest_uri=g(manifest, "manifest_uri"),
        canonical_hash=g(manifest, "canonical_hash"),
        parent_run_id=g(manifest, "parent_run_id"),
        prompt=prompt,
        verified=verified,
    )


def mock_provenance(provider: str, model: str, prompt: str) -> Provenance:
    canonical = hashlib.sha256(
        json.dumps({"provider": provider, "model": model, "prompt": prompt},
                   sort_keys=True).encode()
    ).hexdigest()
    return Provenance(
        provider=provider,
        model=model,
        prompt=prompt,
        sha256=canonical,
        canonical_hash=canonical,
        manifest_uri=f"b2://cineforge/mock/manifests/{canonical[:16]}.json",
        verified=True,
    )
