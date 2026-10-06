# Current experiment status

The requested >70% hard-bot win-rate goal is ACTIVE and NOT YET ACHIEVED.

Workspace: D:/dev/skyjo/skylo, branch codex/skylo-ml-bot.
Base engine/opponent commit: 64a57af86be65a6d59e6a230762a76aecd36084d.
Independent runtime and all data/artifacts: D:/AI/SkyloBot.

Completed:
- Portable Node 24.21.0 and isolated Python 3.13.2 / PyTorch 2.13.0+cu130.
- Real CUDA matrix multiplication passed on the RTX 3080.
- Original 92 tests plus encoder tests pass. The optional real ML runner/replay test
  passes with SKYLO_ML_TEST_MANIFEST pointing to the BC manifest.
- Binary simulator repeated 8000 decisions and 34 full games identically.
- 150000 BC training samples and 20000 samples from separate validation games.
- BC-v1 trained 35 epochs on CUDA. Saved bc-v1.zip and bc-v1.onnx.
- 200 model-selection matches: GPU PyTorch 45.5%; CPU PyTorch and actual Node ONNX
  both 47.5%. CPU and Node outcomes match exactly for every one of the 200 games.
  GPU/CPU arithmetic differences explain why final release uses the deployed CPU bot.
- All games in those evaluations ended naturally by point limit.

Active work (verify live processes/handles/logs before taking action):
- PPO-v1: run.ps1 ppo --checkpoint D:/AI/SkyloBot/runs/bc-v1
  --namespace ppo-training-v1 --steps 2000000 --envs 64
  --output D:/AI/SkyloBot/runs/ppo-v1.
- SKYLO_SNAPSHOT_MODELS=D:/AI/SkyloBot/runs/bc-v1.onnx. Mixed opponents include hard,
  medium, easy, random and the frozen BC policy. About 2200 learner decisions/sec.
- Unified exec session 86478 supervises the PPO command. Latest authoritative log:
  D:/AI/SkyloBot/runs/ppo-v1.log (also ppo-v1/progress.jsonl).
- Immutable step checkpoints and best-validation.json are saved every 250000 steps.
  First 250048-step validation: 51% wins on 200 games, all natural. This is model
  selection only, not the reserved final test.
- Auxiliary teacher-search-v1 process/session 36843 explores cloned STUDENT heuristic
  weights on a training namespace only. It never changes the reference hard bot.
  Early screen: pairs=2 gives 62% on 100 games; pairs=4 or 8 is worse. This is not a
  trained neural model and does not establish goal completion.

Continue the actual goal:
1. Poll the specific live PPO handle / inspect matching process and logs. Do not
   restart merely because a tool observation times out.
2. Inspect validation trajectory. Improve training if needed; do not settle for BC.
3. Select a frozen checkpoint using validation. Export ONNX and write a hashed
   manifest. Use new immutable filenames, never overwrite a tested artifact.
4. Run apps/backend/scripts/ml-evaluate.cjs against the REAL CPU MLBot for >=2000
   full matches, 1000 paired seeds, a fresh final-test-<random> namespace.
5. Use ml/verify_release.py to audit artifacts/outcomes and the one-sided 95% paired
   bootstrap lower bound. Both observed strict win rate and lower bound must exceed
   70%, with no non-natural endings. Ties do not count as wins.
6. Verify current tests, source invariants, final deployment artifact and documentation.
   Only then mark the actual goal complete. Do not deploy/push automatically.

Source-of-truth notes:
- Core and rules.ts remain byte-for-byte unchanged in the Git diff. train.py refuses
  to train if the pinned core/random/rules/protocol differ from baseline.
- The policy gets only the fair TS encoder (1426 floats) and exact legal mask.
- Legacy/global AI environments were not modified. Torch installation reused the
  completed shared D:/AI/Cache/uv wheel cache, with independent venv package metadata.
- Requirement versions are recorded in ml/requirements-lock.txt.
- Every created file is local; no GitHub push, live server change or deployment.

Update 2026-10-06 (active goal; not achieved):
- PPO-v1 best model-selection score reached 62.5% / 200 games at step 1500032,
  all natural. Prior actual Node CPU ONNX check at step 750016 reproduced 57%.
- PPO-v2 is running, unified session 57713, four real-engine workers / 128 envs,
  4 million additional steps from v1 step750016. gamma=.999, GAE=.97, LR=.0002,
  entropy=.01, league opponents. Saved snapshot pool grows on validation improvements.
  500k/1m/1.5m validation: 50% / 53% / 56.5%, all natural; still insufficient.
- Parallel adapter repeatability passed: 8000 decisions, 32 full games, distinct
  worker seed streams and exact repeated trajectories.
- Separated critic migration preserves both initial actor decisions and value output;
  critic gradients cannot change the actor embedding. Save/load tests pass.
- Potential shaping gamma*Phi(next)-Phi(now), terminal Phi=0, uses public views only;
  its discounted contribution telescopes through natural terminal games in a test.
- BC-v2 completed 50 epochs on 300000 stronger-teacher examples, validation 80.25%
  action accuracy. Model-selection 400-game assessment is running in session 53494.
  Artifact D:/AI/SkyloBot/runs/bc-v2.zip. Training hard-teacher win rate was 399/677,
  which demonstrates why 100-game heuristic screens are not reliable strength proof.
- Patient-teacher small training screens: 67%-75% / 100 games. These are auxiliary
  heuristics, NOT the required trained model or final held-out evaluation.
- Patient teacher dataset collection v3 running, session 94548, 300000 examples,
  namespace bc-training-v3: weights pairs2/information.4/endRisk10, closing patience64,
  information patience12. Separate 30000-example bc-validation-v3 is complete.
- Baseline core/opponent remain unchanged. All final-test namespaces remain unused.
- Backend full tests passed 97/97 with the actual PPO ONNX manifest before adding
  the isolated teacher test; new ML tests now pass 5, with optional artifact test
  skipped when its explicit test manifest is absent. Build and diff check pass.

Next: finish live jobs, assess BC-v2, train/assess BC-v3 after collection. Start a
controlled PPO experiment with separated critic and potential shaping, then keep
improving until a frozen CPU ONNX model passes the reserved >=2000-game final gate.
Do not mark the goal complete for setup, teacher strength, or validation alone.

Update 2026-10-06 later (goal remains ACTIVE, no final test has run):
- PPO-v1 finished 2m steps. Best model-selection result 62.5% at 1500032; last56.5%.
- PPO-v2 session57713 continues to4m; best59.5%/200 at2m so far.
- PPO-v3 session15081 continues to4m fromv1step1500032 with separate critic,
  public potential shaping1, gamma.997, GAE.97, LR.0001, entropy.005, league+snapshots.
  Best62%/200 at1000064 so far. Logs ppo-v3.log and training-games.jsonl include
  individual outcomes and per-opponent recent statistics. Training points are still
  shaped by roundReward.25; next experiment should consider0 (actual win-only reward)
  to avoid optimizing blowout margins against already-easy opponents.
- BC-v2 (stronger plain teacher)54.5%/400; BC-v3(patient teacher)55%/400.
  Patient teacher itself won491/690 hard games during training-data collection,
  all natural. Its student does not inherit that winrate automatically.
- DAgger v4 collected200k public states from BC-v3's own policy mixed20% teacher,
  plus separate30k validation. Captures teacher scores for ALL legal actions as
  soft targets without extra decision calls or private information.
- BC-v4 warm-trained50epochs with soft scores, actual validation59.75%/400.
  Teacher-regret diagnosis: placement regret fell .0365 to .0067, but pickup stayed
  about .0645. Therefore public aggregate features were added INSIDE the network.
- BC-v5 uses EnrichedSkyloPolicy: unchanged1426 fair encoder inputs,20 raw public
  arithmetic summaries (max/mean values, card matches/pairs, expected immediate
  draw gain). No fixed teacher scoring or rule decisions at inference. Separate
  critic retained. Migration initial extra weights zero.100epochs completed.
  Artifact D:/AI/SkyloBot/runs/bc-v5.zip. Evaluation400 session1977 and diagnostics
  session15297 currently running; check logs/files before taking dependent action.
- Four pipeline tests pass, including teacher-score transport preserving exact
  observations/actions/rewards, critic isolation, enriched migration save/load and
  real ONNX CPU output parity. Binary transport supports optional28 score floats;
  base reward/done/label offsets are now fixed. All existing PPO processes use the
  unchanged base transport; no running job was restarted due to observation timeout.
- Optional non-natural match endings now yield training terminal reward-1; actual
  engine remains unchanged. Natural finals still mandatory. Manifest reader accepts
  UTF8 BOM. Bot catalogue explicitly labels the supported two-player scope.
- Auxiliary match-aware teacher prototype in ml/planning_teacher.cjs:200-game
  screens73%/72.5%/66.5% for terminal-match bonus10/30/100, all natural. Not integrated
  in simulator and not a learned-model proof. Keep reference rules.ts unchanged.

Next: read BC-v5 validation/teacher-regret. Try a controlled win-only PPO refinement
(roundReward0, gamma~.9995-.9999, small learning rate) from the strongest model, with
league opponents/snapshots. If needed, another DAgger round on the enriched policy.
Select using validation only; freeze/export/hash then use fresh final-test namespace
for actual Node ONNX >=2000 full paired matches and verify_release.py audit.
No push, deployment, external messages, or memory updates have occurred.

Update 2026-10-06 about 22:52 local (goal ACTIVE; no final test started):
- PPO-v2 completed4m; best61.5%/200 at4m. PPO-v3 deliberately stopped for a
  plateau near62%; PPO-v4 stopped because its unsharpened imitation actor sampled
  poorly. Targeted process shutdown verified dedicated commandlines and children.
- BC-v5 enriched policy reached65.5%/400 on GPU model selection; independent
  deployed CPU ONNX validation404/600=67.333%, all600 natural, median .335ms.
  ONNX SHA1e39911aed4fbe4237f8161b7910476d50ea77468685e834eb6344c4c29eeeb6.
- BC-v6 DAgger2/temperature.5 completed;61.5%/400, worse, not selected.
- PPO-v4b session16937 runs from BC-v5,4m actor steps plus200k critic warmup,
  league/4workers/128envs, gamma.9999/GAE.98/LR.00005/entropy.001,
  roundReward0/potential1/logitScale10/targetKL.015, snapshots every improved
  validation. Best68%/200 at1000064, all natural. Next validation at1.5m.
- Node CPU validation of immutable snapshot1000064 running600 games, namespace
  validation-deployment-ppo-v4b-step1m-v1, session98227. Not the reserved final.
- Auxiliary match-aware teacher search400 games/config x4, training-only namespace
  teacher-search-match-training-v2, session77726. No effect on running PPO.
- Pipeline6 tests pass, including critic-only warmup and positive logit scaling.
  Full backend suite with real v4b ONNX manifest running session81341; log
  D:/AI/SkyloBot/runs/backend-tests-v4b.log. Check result before reporting it passed.

Update 2026-10-06 22:55 local (goal ACTIVE; FINAL TEST RUNNING):
- Backend98/98 passed with real v4b ONNX. git diff --check passed.
- Step1000064 actual CPU validation419/600=69.833%, all natural, not selected.
- Step1500032 model-selection154/200=77%; independent CPU validation438/600=73%,
  zero draws, all natural, seats72.667%/73.333%, median .359ms on this Windows PC.
- Selected and FROZEN: D:/AI/SkyloBot/releases/skylo-ml-v1/model.onnx,
  manifest.json, test-plan.json. All three read-only. ONNX831641 bytes,
  SHA01d964bce402be9997028398799175fb8b7b298430671360675c534e88dfeb74.
- FIRST reserved final test is session48461, fixed6000 full matches/3000 pairs,
  namespace final-test-skylo-ml-v1-4ece8a27a60741958de88c39be862ebf.
  Plan was written BEFORE first match at2026-10-06T20:54:59.9735252Z.
  Output D:/AI/SkyloBot/releases/skylo-ml-v1/final-test.json, log same stem.
  Do NOT extend sample size or substitute another model after inspecting results.
  Do NOT call this validation if it fails. Run verify_release.py after completion.
- PPO-v4b still runs independently toward4m plus critic warmup, session16937.
  Later training checkpoints cannot replace the frozen test model mid-test.
- Teacher search session77726 completed: four400-game configs71.5/69.75/68/71%.
  No expert was integrated into the deployed model. No further teacher job running.

Update 2026-10-06 23:02 local (goal ACTIVE; frozen final test unchanged):
- Frontend dependencies installed from unchanged lockfile; build/lint pass. Footer
  labels ml as Skylo ML instead of misleading default medium difficulty.
- contracts:check originally failed due CRLF vs generated LF header only. Verified
  normalized files exactly equal. sync-contracts.mjs now normalizes newlines for
  generation/comparison. Protocol/engine/reference opponent remain unchanged.
- Runtime npm audit for BOTH apps:0 advisories. Existing frontend dev dependencies
  have7 advisories (2moderate/5high), documented, no package-version changes.
- Frozen release passed6/6 dedicated ML tests through real GameRunner/replay.
- Statistical checker passed3 counterexample tests; algorithm/threshold unchanged.
- Final test session48461 at2400/6000. Keep exact model/N/namespace, wait to6000,
  compare completed report to frozen plan, then run verify_release.py.
- Results draft ml/RESULTS.md is explicitly PENDING. Fill actual full test/audit
  result and release README, package/hash evidence only after actual success.

Update 2026-10-06 23:06 local (goal ACTIVE; FINAL TEST still running):
- PPO-v4b actually STOPPED at3000064, session16937 exit1. Optional snapshot export
  failed strict CPU PyTorch/ONNX allclose for2/896 logits (max violating diff .00013185).
  No matching Python/Node training process remains. Saved step3000064.zip retained;
  snapshot3000064.onnx marked via .rejected.json, never added to opponent pool.
- Frozen release1.5m passed export parity previously; its SHA/model/test unchanged.
- Training callback now isolates optional export CalledProcessError, logs rejection,
  preserves checkpoint, skips opponent-pool update, and continues future training.
  Numeric tolerance unchanged. Dedicated failure-path test passes. No new training
  run started because the already-frozen model is in its reserved final test.
- Release source-snapshot copied BEFORE this training callback fix. Provenance hashes
  describe those training/inference sources; runtime MLBot and encoder are unchanged.
- Session48461 currently4100/6000; wait until6000 then verify exact frozen plan,
  run verify_release.py, update PENDING results/docs, package and mark goal complete
  ONLY if actual gate passes. No training job needs cleanup now.

COMPLETE 2026-10-06 23:11 local:
- FIRST reserved final test completed exactly6000 games/3000 paired seeds.
  4409 strict wins=73.483333%,38 draws,1553 losses,6000/6000 natural point-limit ends.
  Seats73.8%/73.1667%; actual CPU ONNX latency median.321ms,p95.6858ms.
- verify_release.py PASS: one-sided95% paired-bootstrap lower72.566667%,20000
  resamples. Completed report exactly matches immutable pretest model/N/namespace.
- Model frozen SHA01d964bce402be9997028398799175fb8b7b298430671360675c534e88dfeb74.
- D:/AI/SkyloBot/releases/skylo-ml-v1.zip1171305 bytes, contents19 files plus
  SHA256SUMS inventory independently verified from inside ZIP.
  ZIP SHA71d99a2a8896f193a2247d81bb43a30d66abc1e5e4c32b4dc16fdc0e2aedb481.
- ml/RESULTS.md and release README now report actual PASS, not pending.
  Source snapshot, provenance, full individual results, gate audit and start guide
  included. All dedicated training/test processes finished. No push or Hetzner
  deployment performed. Working tree changes stay local and uncommitted.
- Final git diff --check and baseline engine/protocol/reference-diff checks pass.

HETZNER INTEGRATION 2026-10-06 (subsequent authorized deployment):
- Frozen ONNX model uploaded separately from public Git; checksum confirmed.
- Linux CPU smoke: 20/20 full games exactly match Windows outcomes/fingerprints.
  Median0.316ms,p950.849ms; runner replay valid, zero fallback.
- PR7 preview: full live Socket.IO match,7rounds,549actions,272model decisions,
  zero fallback, exported replay valid; three-player start blocked.
- UI model/profile selection and player-count guard verified in browser.
- Deployment retains host-managed model activation and TypeSafe settings,
  mounts artifacts read-only and runs candidate inference/replay preflight.
  Isolated rollback/configuration regression passes. No further training started.
