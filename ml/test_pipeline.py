import tempfile
import unittest
from pathlib import Path
import numpy as np
import torch
from sb3_contrib import MaskablePPO
from bridge import SkyloVecEnv
from train import model_for,separate_critic,enrich_policy,set_actor_trainable,scale_actor_logits
from policy import ExportPolicy


class PipelineTest(unittest.TestCase):
    def test_sharpening_keeps_greedy_actions_and_reduces_sampling_entropy(self):
        env=SkyloVecEnv(8,"logit-scale-test",teacher=True)
        try:
            obs=env.reset()
            for _ in range(12):obs,_,_,_=env.step(env.labels)
            model=model_for(env,"cpu")
            a,_=model.predict(obs,action_masks=env.masks,deterministic=True)
            before=model.policy.get_distribution(torch.tensor(obs),action_masks=env.masks).distribution.entropy().detach().clone()
            scale_actor_logits(model,10)
            b,_=model.predict(obs,action_masks=env.masks,deterministic=True)
            after=model.policy.get_distribution(torch.tensor(obs),action_masks=env.masks).distribution.entropy().detach()
            np.testing.assert_array_equal(a,b);self.assertTrue((after<=before+1e-6).all())
        finally:env.close()

    def test_value_warmup_cannot_update_actor(self):
        env=SkyloVecEnv(8,"value-warmup-test",potential_reward=1)
        try:
            model=enrich_policy(model_for(env,"cpu"),env,"cpu")
            before={key:value.clone() for key,value in model.policy.state_dict().items()}
            set_actor_trainable(model,False)
            model.learn(1024)
            changed=[]
            for key,value in model.policy.state_dict().items():
                if key.startswith(('mlp_extractor.value_context.','value_net.')):
                    changed.append(not torch.equal(value,before[key]))
                else:self.assertTrue(torch.equal(value,before[key]),key)
            self.assertTrue(any(changed));set_actor_trainable(model,True)
            self.assertTrue(all(p.requires_grad for p in model.policy.parameters()))
        finally:env.close()

    def test_public_summaries_migrate_and_export_without_changing_initial_policy(self):
        import onnxruntime as ort
        env=SkyloVecEnv(8,"public-summary-test",teacher=True)
        try:
            obs=env.reset()
            for _ in range(12):obs,_,_,_=env.step(env.labels)
            old=model_for(env,"cpu");new=enrich_policy(old,env,"cpu")
            with torch.no_grad():
                expected=ExportPolicy(old.policy)(torch.tensor(obs)).numpy()
                actual=ExportPolicy(new.policy)(torch.tensor(obs)).numpy()
            np.testing.assert_allclose(actual,expected,atol=2e-6)
            with tempfile.TemporaryDirectory(dir="D:/AI/SkyloBot/cache") as folder:
                checkpoint=Path(folder)/"enriched";new.save(checkpoint)
                restored=MaskablePPO.load(checkpoint,device="cpu")
                with torch.no_grad():np.testing.assert_array_equal(ExportPolicy(restored.policy)(torch.tensor(obs)).numpy(),actual)
                target=Path(folder)/"enriched.onnx"
                torch.onnx.export(ExportPolicy(new.policy),torch.tensor(obs),target,input_names=['observation'],output_names=['logits'],
                                  dynamic_axes={'observation':{0:'batch'},'logits':{0:'batch'}},opset_version=17,dynamo=False)
                session=ort.InferenceSession(str(target),providers=['CPUExecutionProvider'])
                output=session.run(None,{'observation':obs})[0]
                np.testing.assert_allclose(output,actual,atol=2e-5,rtol=2e-5)
        finally:env.close()

    def test_teacher_scores_preserve_labels_rewards_and_observations(self):
        plain=SkyloVecEnv(8,"score-protocol-test",teacher=True)
        scored=SkyloVecEnv(8,"score-protocol-test",teacher=True,teacher_scores=True)
        try:
            a=plain.reset();b=scored.reset();np.testing.assert_array_equal(a,b)
            for _ in range(250):
                np.testing.assert_array_equal(plain.labels,scored.labels)
                scores=np.where(scored.masks,scored.teacher_scores,-np.inf)
                self.assertTrue(np.isfinite(scores[scored.masks]).all())
                np.testing.assert_allclose(scores[np.arange(8),scored.labels],scores.max(axis=1),atol=2e-5)
                a,r,d,_=plain.step(plain.labels);b,rs,ds,_=scored.step(scored.labels)
                np.testing.assert_array_equal(a,b);np.testing.assert_array_equal(r,rs);np.testing.assert_array_equal(d,ds)
            self.assertEqual(plain.completions,scored.completions)
        finally:plain.close();scored.close()

    def test_separate_critic_preserves_actor_and_blocks_value_gradient(self):
        env=SkyloVecEnv(8,"critic-migration-test",teacher=True)
        try:
            obs=env.reset();old=model_for(env,"cpu");new=separate_critic(old,env,"cpu")
            a,_=old.predict(obs,action_masks=env.masks,deterministic=True)
            b,_=new.predict(obs,action_masks=env.masks,deterministic=True)
            np.testing.assert_array_equal(a,b)
            with torch.no_grad():
                np.testing.assert_array_equal(old.policy.predict_values(torch.tensor(obs)).numpy(),new.policy.predict_values(torch.tensor(obs)).numpy())
            new.policy.zero_grad()
            new.policy.predict_values(torch.tensor(obs)).sum().backward()
            self.assertTrue(all(p.grad is None for p in new.policy.mlp_extractor.context.parameters()))
            self.assertTrue(any(p.grad is not None for p in new.policy.mlp_extractor.value_context.parameters()))
            with tempfile.TemporaryDirectory(dir="D:/AI/SkyloBot/cache") as folder:
                checkpoint=Path(folder)/"separated";new.save(checkpoint)
                restored=MaskablePPO.load(checkpoint,device="cpu")
                actual,_=restored.predict(obs,action_masks=env.masks,deterministic=True)
                np.testing.assert_array_equal(b,actual)
        finally:env.close()

    def test_sb3_masks_gradients_and_checkpoint_roundtrip(self):
        env=SkyloVecEnv(8,"pipeline-test",teacher=True)
        try:
            obs=env.reset()
            model=model_for(env,"cpu")
            x=torch.tensor(obs)
            distribution=model.policy.get_distribution(x,action_masks=env.masks)
            probabilities=distribution.distribution.probs.detach().numpy()
            self.assertTrue(np.isfinite(probabilities).all())
            np.testing.assert_allclose(probabilities.sum(axis=1),1,atol=1e-6)
            self.assertTrue((probabilities[~env.masks]==0).all())
            actions,_=model.predict(obs,action_masks=env.masks,deterministic=True)
            self.assertTrue(env.masks[np.arange(8),actions].all())
            # SB3 reuses its distribution object; predict() replaces it under no_grad.
            distribution=model.policy.get_distribution(x,action_masks=env.masks)
            loss=-distribution.log_prob(torch.tensor(env.labels)).mean()
            loss.backward()
            gradients=[p.grad for p in model.policy.parameters() if p.grad is not None]
            self.assertTrue(gradients and all(torch.isfinite(g).all() for g in gradients))
            with tempfile.TemporaryDirectory(dir="D:/AI/SkyloBot/cache") as folder:
                checkpoint=Path(folder)/"policy"
                model.save(checkpoint)
                restored=MaskablePPO.load(checkpoint,device="cpu")
                actual,_=restored.predict(obs,action_masks=env.masks,deterministic=True)
                np.testing.assert_array_equal(actions,actual)
            for _ in range(3):
                obs,rewards,dones,infos=env.step(env.labels)
                self.assertEqual(obs.shape,(8,1426))
                self.assertTrue(np.isfinite(obs).all() and np.isfinite(rewards).all())
        finally:
            env.close()


if __name__=="__main__":
    unittest.main()
