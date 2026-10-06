"""Potential rewards must telescope and leave actual game trajectories unchanged."""
import unittest
import numpy as np
from bridge import SkyloVecEnv


def potential(observation):
    own=observation[:,480]*100+observation[:,481]*100+observation[:,482]*12*observation[:,512]*12
    other=observation[:,490]*100+observation[:,491]*100+observation[:,492]*12*observation[:,512]*12
    return (other-own)/50


class PotentialTest(unittest.TestCase):
    def test_discounted_shaping_cancels_at_natural_terminal(self):
        gamma=.999
        plain=SkyloVecEnv(8,"potential-contract-test",teacher=True)
        shaped=SkyloVecEnv(8,"potential-contract-test",teacher=True,potential_reward=1,discount=gamma)
        try:
            obs=plain.reset();np.testing.assert_array_equal(obs,shaped.reset())
            initial=potential(obs)
            difference=np.zeros(8);active=np.ones(8,dtype=bool)
            for step in range(1500):
                actions=plain.labels
                a,r,done,_=plain.step(actions);b,rs,ds,_=shaped.step(actions)
                np.testing.assert_array_equal(a,b);np.testing.assert_array_equal(done,ds)
                difference[active]+=(gamma**step)*(rs[active]-r[active])
                active &= ~done
                if not active.any():break
            self.assertFalse(active.any())
            np.testing.assert_allclose(difference,-initial,atol=2e-5)
            self.assertEqual(plain.completions,shaped.completions)
            self.assertTrue(all(r["endReason"]=="point-limit" for r in plain.completions))
        finally:
            plain.close();shaped.close()


if __name__=="__main__":unittest.main()
