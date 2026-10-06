"""Parallel workers must preserve fair, reproducible, distinct full-game streams."""
import hashlib
import json
import unittest
import numpy as np
from bridge import ParallelSkyloVecEnv


def trajectory():
    env=ParallelSkyloVecEnv(8,2,"parallel-protocol-test",teacher=True)
    digest=hashlib.sha256()
    try:
        obs=env.reset()
        for _ in range(1000):
            assert env.masks[np.arange(8),env.labels].all()
            digest.update(obs.tobytes());digest.update(env.masks.tobytes())
            obs,reward,done,_=env.step(env.labels)
            digest.update(reward.tobytes());digest.update(done.tobytes())
            assert np.isfinite(obs).all() and np.isfinite(reward).all()
        records=sorted(env.completions,key=lambda r:(r["worker"],r["index"]))
        return digest.hexdigest(),records
    finally:
        env.close()


class ParallelTest(unittest.TestCase):
    def test_repeatable_full_games_and_disjoint_seeds(self):
        first,records=trajectory();second,repeated=trajectory()
        self.assertEqual(first,second);self.assertEqual(records,repeated)
        self.assertGreater(len(records),10)
        self.assertTrue(all(r["endReason"]=="point-limit" for r in records))
        self.assertEqual(len({(r["worker"],r["index"]) for r in records}),len(records))
        for record in records:
            self.assertEqual(record["seat"],record["index"]%2)
            self.assertEqual(record["seed"],f'parallel-protocol-test:worker{record["worker"]}:{record["index"]//2}')
        print(json.dumps(dict(stage="parallel-protocol",steps=8000,games=len(records),deterministic=True)))


if __name__=="__main__":
    unittest.main()
