"""Counterexamples for the statistical release gate; no training or real test seeds."""
import copy
import hashlib
import tempfile
import unittest
from pathlib import Path

from verify_release import verify


class ReleaseGateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.model = Path(self.directory.name) / "synthetic-model.onnx"
        self.model.write_bytes(b"synthetic fixture, never used for inference")
        digest = hashlib.sha256(self.model.read_bytes()).hexdigest()
        self.manifest = dict(sha256=digest, ruleVersion="skylo-2-positive-penalty",
                             coreSha256="core-fixture", hardBotSha256="hard-fixture")

    def report(self, winning_pairs):
        # Both seats in a pair share an outcome: deliberately perfect dependence.
        records = [dict(index=i, seat=i % 2, seed=f"final-test-synthetic:{i // 2}",
                        score=90 if i // 2 < winning_pairs else 110, otherScore=100,
                        win=i // 2 < winning_pairs, draw=False, endReason="point-limit")
                   for i in range(2000)]
        return dict(records=records, games=2000, namespace="final-test-synthetic",
                    modelSha256=self.manifest["sha256"], ruleVersion=self.manifest["ruleVersion"],
                    coreSha256="core-fixture", hardBotSha256="hard-fixture", latencyMs={})

    def test_clear_margin_passes_with_pairs_as_resampling_unit(self):
        result = verify(self.report(750), self.manifest, self.model)
        self.assertEqual(result["wins"], 1500)
        self.assertEqual(result["seed_pairs"], 1000)
        self.assertGreater(result["paired_bootstrap_lower_95_one_sided"], .70)
        self.assertTrue(result["gate_passed"])

    def test_point_estimate_alone_cannot_pass(self):
        for pairs in (700, 710):
            result = verify(self.report(pairs), self.manifest, self.model)
            self.assertFalse(result["gate_passed"])
        self.assertEqual(verify(self.report(700), self.manifest, self.model)["win_rate"], .70)

    def test_ties_are_not_wins_and_invalid_records_are_rejected(self):
        tied = self.report(750)
        tied["records"][0].update(score=100, win=False, draw=True)
        result = verify(tied, self.manifest, self.model)
        self.assertEqual(result["wins"], 1499)
        self.assertEqual(result["draws"], 1)
        for change in (dict(win=True, score=110), dict(endReason="action-limit"),
                       dict(seed="training-fixture:0"), dict(index=9)):
            invalid = copy.deepcopy(self.report(750))
            invalid["records"][0].update(change)
            with self.assertRaises(AssertionError):
                verify(invalid, self.manifest, self.model)
        self.model.write_bytes(b"changed artifact")
        with self.assertRaisesRegex(AssertionError, "Artifact hash changed"):
            verify(self.report(750), self.manifest, self.model)


if __name__ == "__main__":
    unittest.main(verbosity=2)
