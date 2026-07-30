"""Provenance helpers — turn a Genblaze manifest into the summary we persist + show in the
canvas provenance drawer. In MOCK_MODE we synthesize a believable manifest."""
from __future__ import annotations
import hashlib
import json
import uuid
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

    # run_id / parent_run_id live on the Run, not the Manifest — reading them off the
    # manifest directly (as this used to) silently returned None and left the lineage empty.
    run = getattr(manifest, "run", None)

    return Provenance(
        manifest_uri=g(manifest, "manifest_uri"),
        canonical_hash=g(manifest, "canonical_hash"),
        run_id=g(run, "run_id"),
        parent_run_id=g(run, "parent_run_id"),
        prompt=prompt,
        verified=verified,
    )


def mock_provenance(provider: str, model: str, prompt: str,
                    parent_run_id: str | None = None) -> Provenance:
    canonical = hashlib.sha256(
        json.dumps({"provider": provider, "model": model, "prompt": prompt},
                   sort_keys=True).encode()
    ).hexdigest()
    # A fresh run id per call (not derived from the prompt) so a regen with the same prompt
    # still links as a distinct child — that's what lets the mock demo the parent chain
    # without spending a credit.
    return Provenance(
        provider=provider,
        model=model,
        prompt=prompt,
        sha256=canonical,
        canonical_hash=canonical,
        manifest_uri=f"b2://cineforge/mock/manifests/{canonical[:16]}.json",
        verified=True,
        run_id=f"mock-{uuid.uuid4().hex[:16]}",
        parent_run_id=parent_run_id,
    )
