# Skylo local ML bot

This project trains an independent policy while reusing the original TypeScript
GameCore and unchanged hard RuleBot. The model uses only the public player view.
The completion criterion and reserved final-test procedure are in EXPERIMENT.md.

## Local Windows runtime

Runtime, caches, datasets and model files live under D:/AI/SkyloBot. The global
Node/Python installation and the other AI environments are not changed.

```powershell
.\ml\setup.ps1
.\ml\run.ps1 collect --samples 150000 --namespace bc-training-v1 --output D:/AI/SkyloBot/data/train-v1.npz
.\ml\run.ps1 collect --samples 20000 --namespace bc-validation-v1 --output D:/AI/SkyloBot/data/validation-v1.npz
.\ml\run.ps1 bc --data D:/AI/SkyloBot/data/train-v1.npz --validation D:/AI/SkyloBot/data/validation-v1.npz --epochs 25 --output D:/AI/SkyloBot/runs/bc-v1
.\ml\run.ps1 assess --checkpoint D:/AI/SkyloBot/runs/bc-v1 --namespace validation-model-selection-v1 --games 200 --output D:/AI/SkyloBot/runs/bc-validation.json
.\ml\run.ps1 export --checkpoint D:/AI/SkyloBot/runs/bc-v1 --output D:/AI/SkyloBot/runs/bc-v1.onnx
$env:SKYLO_SNAPSHOT_MODELS='D:/AI/SkyloBot/runs/bc-v1.onnx'
.\ml\run.ps1 ppo --checkpoint D:/AI/SkyloBot/runs/bc-v1 --namespace ppo-training-v1 --steps 2000000 --output D:/AI/SkyloBot/runs/ppo-v1
```

These are example experiment commands, not a claim that the target has been met.
Each new training run must use a new namespace (or deliberately resume a saved run).
Never use the final test namespace for training or model selection.

## Design

- `src/game/ml/observation.ts`: versioned fair encoder, public progress memory,
  28 fixed actions and exact legality mask. Unknown/zero/removed cells are distinct.
- `src/game/ml/simulator.ts`: batched persistent Node simulations and binary float32
  responses. Opponent decisions use the unchanged real RuleBot. Full 100-point
  matches, alternating seats, and per-match seed-derived bot randomness.
- `bridge.py`: Gym VecEnv adapter. Opponent turns and round transitions are advanced
  to the learner's next decision. Rollouts contain learner decisions only.
- `policy.py`: learned shared candidate scorer and value network. Both receive fair
  observations. There is no rule bot, hidden-state simulation, or search at inference.
- `train.py`: behavioral cloning, SB3 MaskablePPO, validation and ONNX export.
- `MLBot.ts`: asynchronous CPU ONNX inference using the same encoder and legal mask.

The PPO reward combines a terminal strict win/loss signal with a smaller public
round-score-difference signal. It is an optimization choice; the release gate always
uses actual full-match wins. Model-selection evaluation is deterministic and always
against hard. Training includes mixed rule bots and optional frozen ONNX snapshots.
Snapshots are fixed for a match and do not change the opponent implementation.

`ppo --workers 4 --envs 128` runs independent TypeScript simulator processes.
Their seed namespaces are disjoint, with both seats preserved within every worker.
`--opponent league --snapshots` emphasizes hard opponents and adds immutable earlier
ONNX policies when validation improves. Evaluation always uses the unchanged hard bot.

Optional experiments include `--separate-critic`, which copies the current actor
without changing its actions and gives value learning its own state embedding,
and `--potential-reward 1 --gamma .999`, which adds public-state potential rewards.
The latter uses gamma*Phi(next)-Phi(now), with terminal Phi=0; a protocol test checks
that the discounted reward differences telescope through natural match endings.
Training-only teacher weights/patience can generate alternative imitation datasets.
These overrides affect independent teacher instances, never the reference opponent.

`--round-reward 0` trains on terminal match wins only. The current win-focused
experiment also uses `--gamma .9999 --gae .98 --potential-reward 1` to propagate
the long match outcome. `--value-warmup 200000` initially freezes the actor and
fits its separate critic. `--logit-scale 10` preserves the starting greedy policy
while making stochastic rollouts follow its decisions more reliably. Neither
setting changes the card rules or the acceptance test.

`--enrich-state` adds 20 public arithmetic summaries inside the learned model
graph: card minima/maxima, matching counts, and immediate point differences.
New input weights start at zero, so migration initially preserves the policy.
The exported interface remains 1426 numbers. No rule-bot scores or teacher
decisions are model inputs. Optional `collect --behavior-checkpoint ...` collects
teacher labels on the learner's own trajectories (DAgger); score distributions
can be captured with `--teacher-scores` and used as soft cloning targets.

## Deployment artifact

A manifest must identify `version`, `ruleVersion`, `encoderVersion`,
`observationSize`, `actionCount`, `model` (relative ONNX filename) and `sha256`.
Setting `SKYLO_ML_MANIFEST` on the backend enables the versioned model strategy.
The artifact directory should be mounted read-only in the Linux container.
CPU inference needs no Python, CUDA, training dataset or external model account.
Nothing in this training workflow deploys to Hetzner automatically.

The independent `apps/backend/scripts/ml-evaluate.cjs` checker runs the actual
deployed ONNX MLBot against the unchanged hard bot without the Python training
bridge. It saves every seed, seat, score, termination reason and final fingerprint.
Prior evaluation reports cannot be overwritten.

## Checks

```powershell
npm test --prefix apps/backend
$env:SKYLO_NODE='D:/AI/SkyloBot/runtime/node-v24.21.0-win-x64/node.exe'
python ml/smoke_protocol.py
python ml/test_pipeline.py
python ml/test_parallel.py
python ml/test_shaping.py
python ml/test_release_gate.py
python ml/test_snapshot_export.py
```

Training commands refuse to run if the pinned engine, protocol or hard opponent
differs from the original baseline commit. The binary transport smoke test repeats
complete games and compares both encoded observations and outcomes exactly.
An optional snapshot that fails the strict ONNX export comparison is recorded as
rejected and never added to the opponent pool. The saved learner checkpoint is
preserved; future training continues without that snapshot. The export comparison
is not relaxed to accept a rejected artifact.
