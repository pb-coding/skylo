# Skylo monorepo

Frontend and backend of Skylo, imported with both complete Git histories.

## Structure

- `apps/frontend`: React, Three.js and Vite
- `apps/backend`: Express and Socket.IO
- `scripts`: shared development commands
- `docs/legacy-deployment`: original deployment workflows and scripts, retained as reference

## Development

Use Node 24.21.0 LTS from `.nvmrc`, matching CI and the Docker build images.

```sh
npm run setup
npm run deps
npm run dev
```

Frontend: port 5173. Backend: port 3001. These local addresses are for development; cloud browser access needs separate forwarding. Stop both with Ctrl+C. The backend uses the original ts-node command; restart after backend edits.

```sh
npm run check
```

Both apps have their own lockfiles and install dependencies independently. `npm run check` verifies the generated game protocol, runs frontend lint, backend rule/bot/runtime/recording and Socket.IO integration tests, and builds both apps. CI and deployment use the same quality workflow; failed checks or high/critical runtime dependency advisories block deployment.

Games support 2–8 human or bot players and up to 32 spectators. Join as a player or spectator; the first participant hosts the session. Hosts can configure rule-based bots (easy, medium, hard) or random reference bots, choose Jev · TypeSafe when a server-side budget is enabled, start bot-only games, and change the delay between bot actions during play. Pause, single-action and single-turn controls also belong to the host. Spectators can join an ongoing game without occupying a seat.

Completed matches have a downloadable JSON recording and an offline replay checker. See [bots, spectators and replay](docs/bots.md) for usage, timing semantics, limits and the strategy extension API. Human refresh/disconnect still ends participation and aborts the current match; spectator disconnect does not end bot play. Full player resume and durable storage are separate future work. The [phase 1 verification](docs/phase-1.md) and [improvement plan](docs/improvement-plan.md) describe the earlier baseline.

An optional independently trained, two-player ML bot reuses the same engine and
fair player view. Set `SKYLO_ML_MANIFEST` to a verified local ONNX manifest to add
`Skylo · ML (2 Spieler)` to the bot catalogue. See [ML setup](ml/README.md),
[training and evaluation results](ml/RESULTS.md), and the [test contract](ml/EXPERIMENT.md).
Training runs separately from the backend; CPU inference needs no Python or CUDA.
The [ML deployment guide](docs/ml-deployment.md) covers the read-only server
artifact, persistent activation, preflight verification and rollback.

With the local servers running, browser integration checks use an installed Chromium executable:

```sh
SKYLO_BROWSER_URL=http://localhost:5173 npm run browser:check
```

The check creates screenshots, a report and a downloaded replay in `../skylo-verification`. Set `CHROMIUM_PATH` or `SKYLO_VERIFICATION_DIR` to select another browser or output directory.

The selected variant 3 keeps the interactive 3D table and adds a German lobby, invitation links, responsive score rail, turn cues and keyboard/touch card controls. See the [design comparison](design-qa.md) and [desktop/mobile screenshots](docs/design). Two-player voice is supported; group voice and real-network audio verification remain planned.

## Environment and deployment

`npm run setup` creates ignored local `.env` files from `.env.example` without overwriting existing settings. Never commit actual secrets. Previously tracked `.env` files are removed from the new tree but remain in imported history; inspect and rotate any historical credentials before publication if applicable.

Docker build contexts remain the app directories:

```sh
docker build -t skylo-frontend apps/frontend
docker build -t skylo-backend apps/backend
```

The old frontend compose file is retained inside its app as a legacy reference. Production and automatic pull-request previews are configured in `.github/workflows/deploy.yml`. See [Hetzner deployment](docs/deployment.md) for one-time server, Cloudflare, and GitHub setup. The archived deployment files are not active GitHub workflows.
