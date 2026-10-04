# Phase 1: game safety and reliable rendering

Implemented on 2026-10-04, following the improvement plan. This release preserves the existing 3D room and table; the generated design alternatives are review material for the next visual implementation.

## Changes

- Validate card coordinates, phase, turn and cached cards before mutation. Invalid actions keep the current wait active, return a safe acknowledgement and cannot crash the backend.
- Release pending listeners/waits when a game ends or a participant leaves. The 100-point limit is terminal; a subsequent new game in the same room works.
- Require every card in a matching triple to be revealed; remove multiple matching columns safely. Refill the draw pile from discards while retaining its visible top card.
- Store explicit session membership in a separate Socket.IO room namespace. Enforce one session per connection, 2–8 players and host-only starts; reject attempts to replace an active game. Host handoff and counts follow membership.
- Validate and limit signaling payloads, membership and optional destinations. Bound message size and repeated control/game events.
- Bundle the original apartment HDR lighting and Alegreya font locally. Remove the duplicate external Flowbite links. Keep the interface usable when a model fails; provide loading/WebGL/error feedback and preserve the Leave action.
- Surface join/start/round/leave failures and timeouts. Only hosts see Start; actions are disabled while disconnected. Reconnection returns to the lobby explicitly until game resume is implemented.
- Update Node, Nginx and dependencies; remove unused packages. Require reusable quality checks before image publication and deployment.

## Verification

- `npm run check` on Node 24.21.0: frontend lint, 23 backend tests and both production builds pass.
- Engine tests include malformed inputs, hidden and simultaneous triples, draw-pile refill, card conservation, complete round/scoring/next round, terminal game end and 100 game lifecycles without leftover listeners.
- Socket tests cover malformed joins, session collisions, membership, host permission/promotion, limits, presence, signaling and rate bounds.
- Independent actual Socket.IO games with two and eight participants reach the terminal score and restart successfully. More than 2,900 snapshots were checked for card conservation and valid card values. Outsider/nonhost start attempts and ninth-player joins are rejected.
- Local browser tests cover desktop and mobile game rendering, two-player join/start, host-only Start, an intentionally blocked model with visible recovery and working Leave, and reconnection returning to the lobby. The final dependency matrix renders without page errors or failed asset requests.
- Docker builds use the configured certificate trust without disabling TLS verification. Frontend copy permissions make bundled assets readable by Nginx even when the build workspace has restrictive permissions.

## Remaining work

- Stable player identity, session resume and persistence remain planned; refresh, disconnect and backend restart can still end games.
- State/request versioning is not yet implemented. Phase guards reject immediate duplicate actions; delayed coordinates from a previous state require the next protocol iteration.
- The negative-score rule is preserved pending clarification. The eight-player cap is the selected initial limit.
- Desktop/mobile screenshots use software WebGL; they do not establish frame rates on real devices or accessibility compliance.
- The responsive camera, table composition, resource reuse and group voice-chat lifecycle belong to later packages.
- Runtime dependency audits are clean at this snapshot. Five high build-tool findings remain in the Tailwind 3 / braces chain, documented in `deployment.md`; those packages are absent from the frontend runtime image.
- This phase does not implement transactional public-route rollback, stack-specific deployment bundles or durable game storage.

## Preview feedback

Use two separate browsers or devices and the same room name. Only the host should see Start. Play initial reveals, draw/place/discard, leave and rejoin a new game. Try invalid/too-long room names and a room with an active game. For the next visual implementation, select one of the three generated directions before the table and mobile layout are changed.
