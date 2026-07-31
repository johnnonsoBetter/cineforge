from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from backend.ai import qc


class QCEvidenceTests(TestCase):
    def test_persist_frame_uses_content_addressed_b2_key(self) -> None:
        with TemporaryDirectory() as directory:
            frame = Path(directory) / "sample.jpg"
            frame.write_bytes(b"jpeg evidence")
            durable = "https://s3.example.test/cineforge/qc/asset-1/evidence.jpg"

            with patch.object(qc.storage, "put_bytes", return_value=durable) as put:
                self.assertEqual(qc._persist_frame(frame, "asset-1"), durable)

            digest = qc.hashlib.sha256(b"jpeg evidence").hexdigest()
            put.assert_called_once_with(
                f"qc/asset-1/{digest}.jpg", b"jpeg evidence", "image/jpeg"
            )
            self.assertEqual(qc._local_path(durable), frame)

    def test_persist_frame_falls_back_to_local_url(self) -> None:
        with TemporaryDirectory() as directory:
            frame = Path(directory) / "sample.jpg"
            frame.write_bytes(b"jpeg evidence")

            with patch.object(qc.storage, "put_bytes", return_value=None):
                self.assertEqual(
                    qc._persist_frame(frame, "asset-1"), "/api/media/qc/sample.jpg"
                )
