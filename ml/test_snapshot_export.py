"""A snapshot rejection must preserve the checkpoint and keep it out of play."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from train import try_export_snapshot


class SnapshotExportTests(unittest.TestCase):
    def test_rejected_export_is_reported_without_aborting_training(self):
        with tempfile.TemporaryDirectory() as folder:
            checkpoint=Path(folder)/"checkpoint.zip"
            checkpoint.write_bytes(b"saved learner")
            snapshot=Path(folder)/"candidate.onnx"
            snapshot.write_bytes(b"unverified export")
            def rejected(command,**options):
                raise subprocess.CalledProcessError(1,command)
            output=io.StringIO()
            with contextlib.redirect_stdout(output):
                accepted=try_export_snapshot(checkpoint,snapshot,runner=rejected)
            self.assertFalse(accepted)
            self.assertEqual(checkpoint.read_bytes(),b"saved learner")
            report=json.loads(snapshot.with_suffix(".onnx.rejected.json").read_text())
            self.assertEqual(report["status"],"unverified-export-excluded")
            self.assertEqual(report["sha256"],hashlib.sha256(snapshot.read_bytes()).hexdigest())
            self.assertEqual(json.loads(output.getvalue())["stage"],"snapshot-export-failed")


if __name__=="__main__":
    unittest.main(verbosity=2)
