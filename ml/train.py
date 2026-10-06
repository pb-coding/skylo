from __future__ import annotations
import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
import time
import numpy as np
import torch
from stable_baselines3.common.callbacks import BaseCallback
from sb3_contrib import MaskablePPO
from bridge import SkyloVecEnv, ParallelSkyloVecEnv, ROOT, OBSERVATION_SIZE
from policy import SkyloPolicy, SeparatedSkyloPolicy, EnrichedSkyloPolicy, ExportPolicy

OUTPUT = Path(os.environ.get("SKYLO_OUTPUT", "D:/AI/SkyloBot/runs"))
torch.set_num_threads(4)
torch.set_float32_matmul_precision("high")


def emit(**data):
    print(json.dumps(data, ensure_ascii=False), flush=True)


def assert_baseline_unchanged():
    paths=["apps/backend/src/game/core/GameCore.ts", "apps/backend/src/game/core/random.ts",
           "apps/backend/src/game/bots/rules.ts", "apps/backend/src/protocol/gameProtocol.ts"]
    result=subprocess.run(["git","diff","--exit-code","64a57af86be65a6d59e6a230762a76aecd36084d","--",*paths],
                          cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError("Pinned engine, rules or hard opponent were changed")


def model_for(env, device="cuda", seed=20261006, policy_class=SkyloPolicy):
    return MaskablePPO(policy_class, env, device=device, seed=seed, n_steps=128,
                       batch_size=1024, n_epochs=4, learning_rate=1e-4,
                       gamma=0.997, gae_lambda=0.95, ent_coef=0.005,
                       clip_range=0.15, target_kl=0.025, verbose=0,
                       policy_kwargs=dict(net_arch=[], ortho_init=False))


def separate_critic(model,env,device):
    if isinstance(model.policy,SeparatedSkyloPolicy):return model
    migrated=model_for(env,device,policy_class=SeparatedSkyloPolicy)
    state=model.policy.state_dict()
    state.update({key.replace("mlp_extractor.context.","mlp_extractor.value_context."):value.clone()
                  for key,value in list(state.items()) if key.startswith("mlp_extractor.context.")})
    migrated.policy.load_state_dict(state)
    emit(stage="critic-migration",actor_weights_unchanged=True,optimizer="fresh")
    return migrated


def enrich_policy(model,env,device):
    if isinstance(model.policy,EnrichedSkyloPolicy):return model
    model=separate_critic(model,env,device)
    migrated=model_for(env,device,policy_class=EnrichedSkyloPolicy)
    state=migrated.policy.state_dict()
    for key,value in model.policy.state_dict().items():
        if state[key].shape==value.shape:state[key]=value.clone()
        elif key in ['mlp_extractor.context.0.weight','mlp_extractor.value_context.0.weight']:
            state[key].zero_();state[key][:,:value.shape[1]]=value
        else:raise RuntimeError(f'Cannot migrate {key}')
    migrated.policy.load_state_dict(state)
    emit(stage='public-summary-migration',new_inputs=20,initial_input_weights='zero',optimizer='fresh')
    return migrated


def set_actor_trainable(model,trainable):
    if not isinstance(model.policy,SeparatedSkyloPolicy):
        raise ValueError('Critic warmup requires a separate critic')
    for name,parameter in model.policy.named_parameters():
        parameter.requires_grad_(trainable or name.startswith(('mlp_extractor.value_context.','value_net.')))


def scale_actor_logits(model,factor):
    if factor<=0:raise ValueError('Logit scale must be positive')
    with torch.no_grad():
        output=model.policy.mlp_extractor.scorer[-1]
        output.weight.mul_(factor);output.bias.mul_(factor)


def collect(args):
    if not 0<=args.teacher_mix<=1:raise ValueError("Teacher mix must be in [0,1]")
    options=dict(opponent="mixed",teacher=True,teacher_weights=json.loads(args.teacher_weights) if args.teacher_weights else None,
                 teacher_patience=json.loads(args.teacher_patience) if args.teacher_patience else None,teacher_scores=args.teacher_scores)
    env=(ParallelSkyloVecEnv(args.envs,args.workers,args.namespace,**options) if args.workers>1
         else SkyloVecEnv(args.envs,args.namespace,**options))
    started = time.time()
    observations, masks, labels, scores = [], [], [], []
    behavior=MaskablePPO.load(args.behavior_checkpoint,device="cuda") if args.behavior_checkpoint else None
    mixing=np.random.default_rng(619276)
    try:
        obs = env.reset()
        count = 0
        while count < args.samples:
            observations.append(obs.astype(np.float16))
            masks.append(env.masks.astype(np.uint8))
            labels.append(env.labels.copy())
            if args.teacher_scores:scores.append(env.teacher_scores.astype(np.float16))
            actions=env.labels.copy()
            if behavior is not None:
                learned,_=behavior.predict(obs,action_masks=env.masks,deterministic=True)
                actions=np.where(mixing.random(args.envs)<args.teacher_mix,actions,learned)
            obs, _, _, _ = env.step(actions)
            count += args.envs
            if count % (args.envs * 100) == 0:
                emit(stage="collect", samples=count, games=len(env.completions), samples_per_second=count/(time.time()-started))
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        extra=dict(teacher_scores=np.concatenate(scores)[:args.samples]) if args.teacher_scores else {}
        np.savez_compressed(output, observations=np.concatenate(observations)[:args.samples],
                            masks=np.concatenate(masks)[:args.samples], labels=np.concatenate(labels)[:args.samples],**extra)
        metadata = dict(namespace=args.namespace, samples=args.samples, created=time.time(),
                        completions=env.completions, ruleVersion=env.header["ruleVersion"],
                        encoderVersion=env.header["encoderVersion"],teacher_weights=options["teacher_weights"],
                        teacher_patience=options["teacher_patience"],teacher_scores=args.teacher_scores,workers=args.workers)
        metadata.update(behavior_checkpoint=args.behavior_checkpoint,teacher_mix=args.teacher_mix)
        output.with_suffix(".json").write_text(json.dumps(metadata, indent=2))
        emit(stage="collected", path=str(output), elapsed=time.time()-started, samples=args.samples)
    finally:
        env.close()


def bc(args):
    if args.score_temperature<=0:raise ValueError("Score temperature must be positive")
    env = SkyloVecEnv(1, "shape-only")
    model = MaskablePPO.load(args.checkpoint,env=env,device=args.device) if args.checkpoint else model_for(env, args.device)
    if args.enrich_state:model=enrich_policy(model,env,args.device)
    env.close()
    train = np.load(args.data)
    valid = np.load(args.validation)
    if args.replay_data:
        replay=np.load(args.replay_data)
        index=np.random.default_rng(619276).choice(len(replay['labels']),min(args.replay_samples,len(replay['labels'])),replace=False)
        train={key:np.concatenate([train[key],replay[key][index]]) for key in train.files}
    x = torch.tensor(train["observations"], dtype=torch.float32, device=args.device)
    masks = torch.tensor(train["masks"], dtype=torch.bool, device=args.device)
    labels = torch.tensor(train["labels"], dtype=torch.int64, device=args.device)
    targets=(torch.tensor(train["teacher_scores"],dtype=torch.float32,device=args.device).masked_fill(~masks,-1e8)/args.score_temperature).softmax(dim=1) if "teacher_scores" in train else None
    vx = torch.tensor(valid["observations"], dtype=torch.float32, device=args.device)
    vm = torch.tensor(valid["masks"], dtype=torch.bool, device=args.device)
    vy = torch.tensor(valid["labels"], dtype=torch.int64, device=args.device)
    optimizer = torch.optim.Adam(model.policy.parameters(), lr=args.lr)
    model.policy.set_training_mode(True)
    started = time.time()
    for epoch in range(args.epochs):
        order = torch.randperm(len(x), device=args.device)
        losses=[]
        for start in range(0, len(x), args.batch):
            index = order[start:start+args.batch]
            distribution = model.policy.get_distribution(x[index], action_masks=masks[index])
            loss = (-(targets[index]*distribution.distribution.logits).sum(dim=1).mean() if targets is not None
                    else -distribution.log_prob(labels[index]).mean())
            optimizer.zero_grad(set_to_none=True); loss.backward()
            torch.nn.utils.clip_grad_norm_(model.policy.parameters(), 1)
            optimizer.step(); losses.append(loss.item())
        model.policy.set_training_mode(False)
        with torch.no_grad():
            vloss=[]; vacc=[]
            for start in range(0,len(vx),args.batch):
                d=model.policy.get_distribution(vx[start:start+args.batch], action_masks=vm[start:start+args.batch])
                vloss.append(-d.log_prob(vy[start:start+args.batch]).mean().item())
                vacc.append((d.get_actions(deterministic=True)==vy[start:start+args.batch]).float().mean().item())
        emit(stage="bc", epoch=epoch+1, loss=float(np.mean(losses)), validation_loss=float(np.mean(vloss)),
             validation_label_accuracy=float(np.mean(vacc)), elapsed=time.time()-started)
        model.save(args.output)
        model.policy.set_training_mode(True)
    checkpoint=Path(args.output)
    if checkpoint.suffix!='.zip':checkpoint=checkpoint.with_suffix('.zip')
    provenance=dict(checkpoint=str(checkpoint),sha256=hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
                    data=args.data,data_sha256=hashlib.sha256(Path(args.data).read_bytes()).hexdigest(),
                    validation=args.validation,validation_sha256=hashlib.sha256(Path(args.validation).read_bytes()).hexdigest(),
                    warm_start=args.checkpoint,replay_data=args.replay_data,replay_samples=args.replay_samples if args.replay_data else 0,
                    samples=len(x),epochs=args.epochs,learning_rate=args.lr,score_temperature=args.score_temperature,
                    soft_targets=targets is not None,policy=model.policy.__class__.__name__,elapsed=time.time()-started,device=args.device)
    checkpoint.with_suffix('.training.json').write_text(json.dumps(provenance,indent=2))
    emit(stage="bc-finished",**provenance)


def evaluate(model, games=200, namespace="validation-v1", envs=64, opponent="hard"):
    env = SkyloVecEnv(min(envs,games), namespace, opponent=opponent, limit_episodes=games)
    started=time.time()
    try:
        obs=env.reset()
        while len(env.completions)<games:
            actions,_=model.predict(obs, action_masks=env.masks, deterministic=True)
            obs,_,_,_=env.step(actions)
        records=sorted(env.completions, key=lambda r:r["index"])
        assert len(records)==games and [r["index"] for r in records]==list(range(games))
        wins=sum(r["win"] for r in records)
        draws=sum(r["draw"] for r in records)
        natural=sum(r["endReason"]=="point-limit" for r in records)
        result=dict(games=games, wins=wins, draws=draws, win_rate=wins/games, natural=natural,
                    mean_point_difference=float(np.mean([r["otherScore"]-r["score"] for r in records])),
                    namespace=namespace, elapsed=time.time()-started,
                    seat_win_rates=[float(np.mean([r["win"] for r in records if r["seat"]==seat])) for seat in [0,1]])
        if games % 2==0:
            pairs=np.array([float(r["win"]) for r in records]).reshape(-1,2).mean(axis=1)
            rng=np.random.default_rng(917260)
            samples=[]
            for _ in range(100):
                samples.extend(rng.choice(pairs, (100,len(pairs)), replace=True).mean(axis=1).tolist())
            result["paired_bootstrap_lower_95_one_sided"]=float(np.quantile(samples,0.05))
        return result,records
    finally:
        env.close()


def try_export_snapshot(checkpoint, snapshot, runner=None):
    """An optional failed export never enters the opponent pool or loses training."""
    snapshot=Path(snapshot)
    try:
        (runner or subprocess.run)([sys.executable,__file__,"export","--checkpoint",
                                  str(checkpoint),"--output",str(snapshot)],check=True)
    except subprocess.CalledProcessError as error:
        failure=dict(stage="snapshot-export-failed",checkpoint=str(checkpoint),
                     path=str(snapshot),returncode=error.returncode,status="unverified-export-excluded")
        if snapshot.exists():failure["sha256"]=hashlib.sha256(snapshot.read_bytes()).hexdigest()
        snapshot.with_suffix(snapshot.suffix+".rejected.json").write_text(json.dumps(failure,indent=2))
        emit(**failure)
        return False
    return True


class Progress(BaseCallback):
    def __init__(self, output, env, interval, evaluation_games, snapshots=False):
        super().__init__()
        self.output=Path(output);self.env=env;self.interval=interval;self.next_eval=interval
        self.started=time.time();self.evaluation_games=evaluation_games
        self.best=-1.0;self.last_games=0
        self.snapshots=snapshots
        self.pool=list(env.options.get("snapshotModels", []))
        self.output.mkdir(parents=True,exist_ok=True)
        self.log=open(self.output/"progress.jsonl","a",buffering=1)

    def _on_step(self):
        if self.n_calls % 128 ==0:
            games=self.env.completions[self.last_games:];self.last_games=len(self.env.completions)
            record=dict(stage="ppo",steps=self.num_timesteps,elapsed=time.time()-self.started,
                        samples_per_second=self.num_timesteps/(time.time()-self.started),games=len(games),
                        recent_win_rate=float(np.mean([r["win"] for r in games])) if games else None,
                        natural=sum(r["endReason"]=="point-limit" for r in games),
                        learning={k:float(v) for k,v in self.model.logger.name_to_value.items()
                                  if k in ["train/approx_kl","train/entropy_loss","train/value_loss","train/explained_variance"]})
            record["opponents"]={opponent:dict(games=len(group),win_rate=float(np.mean([r["win"] for r in group])),
                                                mean_point_difference=float(np.mean([r["otherScore"]-r["score"] for r in group])))
                                 for opponent in sorted({r["opponent"] for r in games})
                                 if (group:=[r for r in games if r["opponent"]==opponent])}
            with open(self.output/"training-games.jsonl","a") as history:
                for game in games:history.write(json.dumps({**game,"learner_steps":self.num_timesteps})+"\n")
            emit(**record);self.log.write(json.dumps(record)+"\n");self.log.flush()
            self.model.save(self.output/"latest")
        if self.num_timesteps>=self.next_eval:
            self.next_eval+=self.interval
            result,_=evaluate(self.model,self.evaluation_games,"validation-model-selection-v1")
            result.update(stage="validation",steps=self.num_timesteps)
            emit(**result);self.log.write(json.dumps(result)+"\n");self.log.flush()
            self.model.save(self.output/f"step-{self.num_timesteps}")
            if result["win_rate"]>self.best and result["natural"]==result["games"]:
                self.best=result["win_rate"];self.model.save(self.output/"best")
                (self.output/"best-validation.json").write_text(json.dumps(result,indent=2))
                if self.snapshots:
                    snapshot=self.output/f"snapshot-{self.num_timesteps}.onnx"
                    # Separate process keeps training RNG and optimizer state intact.
                    if try_export_snapshot(self.output/f"step-{self.num_timesteps}",snapshot):
                        self.pool=(self.pool+[str(snapshot)])[-4:]
                        self.env.update_snapshots(self.pool)
                        emit(stage="snapshot-pool",paths=self.pool)
        return True


def ppo(args):
    options=dict(opponent=args.opponent,round_reward=args.round_reward,potential_reward=args.potential_reward,discount=args.gamma)
    env=(ParallelSkyloVecEnv(args.envs,args.workers,args.namespace,**options)
         if args.workers>1 else SkyloVecEnv(args.envs,args.namespace,**options))
    model=MaskablePPO.load(args.checkpoint,env=env,device=args.device) if args.checkpoint else model_for(env,args.device)
    if args.separate_critic:model=separate_critic(model,env,args.device)
    if args.enrich_state:model=enrich_policy(model,env,args.device)
    if args.logit_scale!=1:scale_actor_logits(model,args.logit_scale)
    model.learning_rate=args.lr
    model.lr_schedule=lambda _:args.lr
    model.ent_coef=args.entropy
    model.gamma=args.gamma;model.gae_lambda=args.gae;model.n_epochs=args.epochs
    model.rollout_buffer.gamma=args.gamma;model.rollout_buffer.gae_lambda=args.gae
    model.target_kl=args.target_kl
    callback=Progress(args.output,env,args.eval_interval,args.eval_games,args.snapshots)
    emit(stage="ppo-configuration",checkpoint=args.checkpoint,steps=args.steps,namespace=args.namespace,
         gamma=model.gamma,gae_lambda=model.gae_lambda,learning_rate=args.lr,entropy=args.entropy,
         epochs=model.n_epochs,target_kl=model.target_kl,round_reward=args.round_reward,
         opponent=args.opponent,workers=args.workers,potential_reward=args.potential_reward,logit_scale=args.logit_scale,
         value_warmup=args.value_warmup,snapshot_pool=env.options["snapshotModels"])
    try:
        if args.value_warmup:
            set_actor_trainable(model,False)
            model.learning_rate=3e-4;model.lr_schedule=lambda _:3e-4
            emit(stage='value-warmup',steps=args.value_warmup,actor_frozen=True)
            model.learn(args.value_warmup,callback=callback,reset_num_timesteps=True)
            model.save(Path(args.output)/'critic-warm')
            set_actor_trainable(model,True)
            model.learning_rate=args.lr;model.lr_schedule=lambda _:args.lr
        model.learn(args.steps,callback=callback,reset_num_timesteps=not bool(args.value_warmup))
        model.save(Path(args.output)/"last")
    finally:
        callback.log.close();env.close()


def assess(args):
    checkpoint=Path(args.checkpoint)
    if checkpoint.suffix!=".zip": checkpoint=checkpoint.with_suffix(".zip")
    digest=hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    model=MaskablePPO.load(checkpoint,device=args.device)
    result,records=evaluate(model,args.games,args.namespace,args.envs)
    result.update(checkpoint=str(checkpoint),sha256=digest,records=records,
                  rules_sha256=hashlib.sha256((ROOT/"apps/backend/src/game/core/GameCore.ts").read_bytes()).hexdigest(),
                  opponent_sha256=hashlib.sha256((ROOT/"apps/backend/src/game/bots/rules.ts").read_bytes()).hexdigest())
    result["gate_passed"]=result["win_rate"]>0.70 and result.get("paired_bootstrap_lower_95_one_sided",0)>0.70 and result["natural"]==args.games
    Path(args.output).write_text(json.dumps(result,indent=2))
    emit(stage="assessment",**{k:v for k,v in result.items() if k!="records"})


def export(args):
    model=MaskablePPO.load(args.checkpoint,device="cpu")
    model.policy.set_training_mode(False)
    module=ExportPolicy(model.policy)
    dummy=torch.zeros(2,OBSERVATION_SIZE)
    torch.onnx.export(module,dummy,args.output,input_names=["observation"],output_names=["logits"],
                      dynamic_axes={"observation":{0:"batch"},"logits":{0:"batch"}},opset_version=17,dynamo=False)
    import onnxruntime as ort
    rng=np.random.default_rng(9127)
    x=rng.normal(size=(32,OBSERVATION_SIZE)).astype(np.float32)
    session=ort.InferenceSession(args.output,providers=["CPUExecutionProvider"])
    actual=session.run(None,{"observation":x})[0]
    with torch.no_grad(): expected=module(torch.from_numpy(x)).numpy()
    np.testing.assert_allclose(actual,expected,atol=2e-5,rtol=2e-5)
    emit(stage="export",path=args.output,max_absolute_error=float(np.abs(actual-expected).max()),
         sha256=hashlib.sha256(Path(args.output).read_bytes()).hexdigest())


def main():
    assert_baseline_unchanged()
    parser=argparse.ArgumentParser()
    commands=parser.add_subparsers(dest="command",required=True)
    p=commands.add_parser("collect");p.add_argument("--samples",type=int,default=150000);p.add_argument("--envs",type=int,default=64)
    p.add_argument("--namespace",required=True);p.add_argument("--output",required=True);p.set_defaults(func=collect)
    p.add_argument("--workers",type=int,default=1);p.add_argument("--teacher-weights")
    p.add_argument("--teacher-patience")
    p.add_argument("--teacher-scores",action="store_true")
    p.add_argument("--behavior-checkpoint");p.add_argument("--teacher-mix",type=float,default=.2)
    p=commands.add_parser("bc");p.add_argument("--data",required=True);p.add_argument("--validation",required=True)
    p.add_argument("--epochs",type=int,default=20);p.add_argument("--batch",type=int,default=2048);p.add_argument("--lr",type=float,default=3e-4)
    p.add_argument("--device",default="cuda");p.add_argument("--output",required=True);p.set_defaults(func=bc)
    p.add_argument("--score-temperature",type=float,default=1)
    p.add_argument("--checkpoint")
    p.add_argument("--enrich-state",action="store_true")
    p.add_argument("--replay-data");p.add_argument("--replay-samples",type=int,default=50000)
    p=commands.add_parser("ppo");p.add_argument("--checkpoint");p.add_argument("--envs",type=int,default=64)
    p.add_argument("--namespace",required=True);p.add_argument("--opponent",default="mixed");p.add_argument("--steps",type=int,default=2000000)
    p.add_argument("--lr",type=float,default=1e-4);p.add_argument("--entropy",type=float,default=.005);p.add_argument("--round-reward",type=float,default=.25)
    p.add_argument("--eval-interval",type=int,default=250000);p.add_argument("--eval-games",type=int,default=200)
    p.add_argument("--device",default="cuda");p.add_argument("--output",required=True);p.set_defaults(func=ppo)
    p.add_argument("--gamma",type=float,default=.997);p.add_argument("--gae",type=float,default=.95)
    p.add_argument("--epochs",type=int,default=4);p.add_argument("--target-kl",type=float,default=.025)
    p.add_argument("--snapshots",action="store_true")
    p.add_argument("--workers",type=int,default=1)
    p.add_argument("--potential-reward",type=float,default=0)
    p.add_argument("--separate-critic",action="store_true")
    p.add_argument("--enrich-state",action="store_true")
    p.add_argument("--value-warmup",type=int,default=0)
    p.add_argument("--logit-scale",type=float,default=1)
    p=commands.add_parser("assess");p.add_argument("--checkpoint",required=True);p.add_argument("--namespace",required=True)
    p.add_argument("--games",type=int,default=200);p.add_argument("--envs",type=int,default=64);p.add_argument("--device",default="cuda")
    p.add_argument("--output",required=True);p.set_defaults(func=assess)
    p=commands.add_parser("export");p.add_argument("--checkpoint",required=True);p.add_argument("--output",required=True);p.set_defaults(func=export)
    args=parser.parse_args();args.func(args)


if __name__=="__main__":
    main()
