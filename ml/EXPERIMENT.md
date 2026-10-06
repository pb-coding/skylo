# Skylo ML training contract

Goal: a trained, standalone learned policy wins strictly more than 70% of full
two-player matches against the unchanged hard RuleBot, using fair player observations.

- Base repository commit: 64a57af86be65a6d59e6a230762a76aecd36084d.
- Rules: skylo-2-positive-penalty, point limit 100, max rounds 100, max actions 100000.
- Core and hard opponent implementation are not modified to improve the result.
- No seed, core state, hidden card, hidden draw order, or fingerprint is a policy input.
- Unknown, zero and removed cards have distinct representations.
- Seats are swapped for each card seed. Ties do not count as wins.
- Training, model-selection validation, and final test use separate seed namespaces.
- Final test starts only after the model artifact is frozen and hashed.
- Release gate: observed strict win rate >70%, one-sided 95% paired-bootstrap lower
  confidence bound >70%, and every game ends naturally by the point limit.
- At least 1000 final test seed pairs (2000 full matches), with per-match results saved.
- Choose the full even test size before starting the reserved test. Do not extend
  it after inspecting intermediate wins to chase a passing confidence bound.
- A failed final test is reported and never relabeled as validation retroactively.
- Exported CPU inference must agree with PyTorch and use the same TS encoder/mask.

Runtime, caches, datasets and checkpoints are under D:/AI/SkyloBot. Source lives in
the repository. Training does not contact external model providers or deployment.
