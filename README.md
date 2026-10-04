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

Both apps have their own lockfiles and install dependencies independently. `npm run check` runs frontend lint, backend regression and Socket.IO integration tests, and both builds. CI and deployment use the same quality workflow; failed checks or high/critical runtime dependency advisories block deployment.

Games support 2–8 players. The first participant hosts the session and can start a new game. Refreshing or disconnecting still ends participation; session resume and durable game storage are planned separately. See [phase 1 verification](docs/phase-1.md) and the [improvement plan](docs/improvement-plan.md).

## Environment and deployment

`npm run setup` creates ignored local `.env` files from `.env.example` without overwriting existing settings. Never commit actual secrets. Previously tracked `.env` files are removed from the new tree but remain in imported history; inspect and rotate any historical credentials before publication if applicable.

Docker build contexts remain the app directories:

```sh
docker build -t skylo-frontend apps/frontend
docker build -t skylo-backend apps/backend
```

The old frontend compose file is retained inside its app as a legacy reference. Production and automatic pull-request previews are configured in `.github/workflows/deploy.yml`. See [Hetzner deployment](docs/deployment.md) for one-time server, Cloudflare, and GitHub setup. The archived deployment files are not active GitHub workflows.
