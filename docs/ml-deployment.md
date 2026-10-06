# ML bot on Hetzner

The release `skylo-ml-v1-ppo1500032` is a standalone CPU ONNX policy for exactly
two players. The original TypeScript rules, hard opponent and public protocol
remain unchanged. It requires no Python, GPU, training process or paid API.
The trained weights and training data are not published in this repository.

## Artifact and activation

The server directory `/home/pb/apps/skylo/models` is mounted read-only at
`/opt/skylo/models` in backend containers. Install each release in a new directory;
never replace bytes belonging to an existing version. For the first release:

- `models/skylo-ml-v1/model.onnx` (831641 bytes)
- `models/skylo-ml-v1/manifest.json`
- Model SHA-256: `01d964bce402be9997028398799175fb8b7b298430671360675c534e88dfeb74`

Back up the private stack environment file before editing. Set this single
non-secret setting in `stacks/skylo-prod.env` to activate the model:

```text
SKYLO_ML_MANIFEST=/opt/skylo/models/skylo-ml-v1/manifest.json
```

Run the normal deployment command for a published image SHA. CI preserves this
host-managed setting on later updates, independently of TypeSafe configuration.
Previews start with ML disabled; each preview may be explicitly enabled using its
own stack environment file. Missing or incompatible manifests or model checksums
fail backend startup, causing the existing deployment rollback to run.
When ML is enabled, every update also runs two full games and a replay check in
the candidate image before replacing the running backend. A failed preflight
restores the previous stack settings.

In the lobby add a bot, then choose **Skylo · ML (2 Spieler)** and the
**Zweispieler-Modell** profile. A third seat makes that strategy unavailable and
blocks match start on both the client and server. Other strategies retain their
normal player limits. Model version and decisions are recorded in match exports;
the normal runner visibly marks any exceptional fallback.

## Runtime verification

Run inside the new image before activation; it uses the packaged CPU runtime,
full 100-point games, both seats, and a real runner with replay verification:

```sh
docker run --rm --network none \
  -v /home/pb/apps/skylo/models:/opt/skylo/models:ro \
  ghcr.io/pb-coding/skylo-backend:<published-image-sha> \
  node scripts/ml-runtime-smoke.cjs /opt/skylo/models/skylo-ml-v1/manifest.json 20
```

Compare `results` with the same command on Windows: seeds, scores, action counts
and final fingerprints must match. Timings are platform dependent. This smoke
test checks deployment compatibility; the independent 6000-game strength test is
documented separately in [ML results](../ml/RESULTS.md).

## Rollback

Retain the old image SHA and a private backup of deployment files and stack
settings. Remove `SKYLO_ML_MANIFEST` (or set it empty) and deploy the previous image
with `bash deploy/deploy.sh up prod <previous-sha>`. A failed image update restores
the previous stack environment automatically. Keep immutable model releases for
reproducibility. Do not remove the TypeSafe usage volume. Redeploys end in-memory
game sessions, as with other Skylo releases.
