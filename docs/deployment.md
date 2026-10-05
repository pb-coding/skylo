# Hetzner deployment

Production is `https://skylo.pb-vps.org`. Each pull request from this repository gets `https://pr-<number>.skylo-dev.pb-vps.org` and is removed when the pull request closes. Fork pull requests build in CI but do not receive a preview because they cannot use deployment secrets. All instances use separate frontend and backend containers and share only the reverse proxy network. Game sessions are in memory and are lost on redeploy.

## One-time server setup

1. Point the Cloudflare DNS records for `skylo.pb-vps.org` and `*.skylo-dev.pb-vps.org` at the Hetzner server. The existing Traefik container already owns TCP ports 80 and 443. Cloudflare's SSL mode should be **Full (strict)** and WebSockets should be enabled.
2. Docker Engine 29.5.3 and Compose 5.1.4 are already installed. Traefik v3.6 uses Docker network `proxy`, entrypoint `websecure`, and ACME resolver `letsencrypt` with HTTP challenge on `web`. Skylo joins this existing network and asks Traefik to issue a certificate per hostname. The HTTP challenge cannot issue wildcard certificates, but it can issue certificates for each `pr-<number>` hostname. A Cloudflare API token is not needed. Keep the existing Traefik deployment intact.
3. Reuse the existing `pb` deployment user after confirming its SSH and Docker access. Create `/home/pb/apps/skylo/deploy` under its application directory. The `pb` user already belongs to the `docker` group. Docker group membership grants host-level control, so restrict who can edit deployment workflows.
4. Add GitHub repository secrets `HETZNER_SSH_HOST`, `HETZNER_SSH_PORT`, `HETZNER_SSH_USER`, `HETZNER_SSH_KEY` (private key), and `HETZNER_KNOWN_HOSTS` (the **verified** SSH host key line, including `[host]:port` for a non-default port). Verify the fingerprint through the Hetzner console or another trusted channel before setting `KNOWN_HOSTS`; an unverified `ssh-keyscan` result is insufficient. The workflow uses the built-in `GITHUB_TOKEN` for GHCR and needs repository Actions package write access. Create GitHub environments named `production` and `preview`.
5. Push this repository to `main`. Production deploys on each push to `main`; internal pull requests deploy and update previews automatically. The workflow summary contains the preview URL. Before any Docker images are published, the deployment workflow runs the same reusable quality checks as CI: clean dependency installation, runtime dependency audit (high/critical findings block), frontend lint, backend regression/socket tests, and both production builds. A failed quality check blocks image publication and deployment. Docker image builds are cached in GitHub Actions. The first build and certificate issuance take longer than later updates.

The deployment user must be able to create `/home/pb/apps/skylo/deploy` and `/home/pb/apps/skylo/stacks`. The workflow copies deployment files to the server, logs into GHCR using an ephemeral per-job Docker config, updates the target stack on Traefik's existing `proxy` network, waits for both containers to be healthy, then checks the public page and Socket.IO endpoint. A failed Compose update restores the previous image tag when one exists. Closing a pull request removes its containers and stack environment file. Certificate storage remains managed by the existing Traefik deployment.

## Manual operations

Local development, CI and backend containers use Node 24.21.0 LTS, pinned in `.nvmrc` and the Dockerfiles. The frontend is served by Nginx 1.30. Run `npm run deps` followed by `npm run check` from the repository root before publishing a change. The backend test suite uses Node's test runner and `ts-node` only during development; production images contain compiled JavaScript and omit development dependencies.

The dependency review on 2026-10-04 reported zero advisories for backend dependencies and frontend runtime dependencies. The full frontend audit still reports five high findings in the Tailwind 3 build-tool chain, stemming from `braces` 3.0.3. The registry currently offers no patched 3.x release; npm recommends a Tailwind 4 migration. These tools run during development/build and are absent from the Nginx runtime image. Track that migration separately and avoid supplying untrusted arbitrary glob patterns to the build tools. CI audits runtime dependencies and does not suppress or mislabel the remaining build-tool findings.

After the workflow has copied files, the server-side commands are:

```sh
cd /home/pb/apps/skylo
bash deploy/deploy.sh up prod <40-character-commit-sha>
bash deploy/deploy.sh up pr <number> <40-character-commit-sha>
bash deploy/deploy.sh down pr <number>
docker compose -p skylo-prod --env-file stacks/skylo-prod.env -f deploy/compose.app.yml logs -f
```

For private GHCR packages, log in with a package-read token before manual `up`. CI handles registry login itself. To roll back production, run `up prod` with a previously published commit SHA. The preview stacks use the same production build, with their Socket.IO connections routed on the same preview host.

## Environment limits

The current app uses WebRTC peer connections for voice chat. STUN/TURN is not configured, so calls across some NATs or restrictive networks can fail even when the game and Socket.IO work. The existing application stores games only in process memory; each instance is one backend replica.

## TypeSafe Jev

The environment secret `TYPESAFE_API_KEY` is forwarded to the backend only via SSH stdin. GitHub environment variables configure `TYPESAFE_MODEL`, `TYPESAFE_MAX_REQUESTS`, `TYPESAFE_MAX_REQUESTS_PER_MATCH`, and `TYPESAFE_DECISION_TIMEOUT_MS`. Total usage defaults to **0**: a key does not authorize paid preview or production games. Codex smoke-test authorization does not increase deployment budgets. See [Jev operation and validation](jev-bot-implementation.md).

Stack environment files now contain the backend secret and are created with private permissions. Avoid printing them or rendered Compose configurations. The persistent `typesafe-usage` volume preserves the request count across updates and manual rollbacks; manual image updates also preserve the existing TypeSafe settings. Removing a preview removes its usage volume. Each stack has a separate request cap; account-wide limits across independently authorized stacks remain an operator responsibility.

The CI helper `ci-deploy.sh up` now consumes a JSON object containing `registryToken` and the whitelisted `typesafe` settings over stdin. Direct manual operations continue to use `deploy.sh` with an already configured registry login.
