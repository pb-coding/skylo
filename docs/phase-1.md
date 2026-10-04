# Phase 1: game safety and selected 3D design

Implemented on 2026-10-04, following the improvement plan. The user selected the third displayed design alternative. This release keeps a real, interactive 3D room and implements that direction with a dark interface, a teal felt table, large personal cards and a compact score rail. The exact reference is `docs/design/selected-variant-3.png`; the visual comparison and accepted live-state differences are recorded in `design-qa.md`.

## Changes

- Validate card coordinates, phase, turn and cached cards before mutation. Invalid actions keep the current wait active, return a safe acknowledgement and cannot crash the backend.
- Release pending listeners/waits when a game ends or a participant leaves. The 100-point limit is terminal; a subsequent new game in the same room works.
- Require every card in a matching triple to be revealed; remove multiple matching columns safely. Refill the draw pile from discards while retaining its visible top card.
- Store explicit session membership in a separate Socket.IO room namespace. Enforce one session per connection, 2–8 players and host-only starts; reject attempts to replace an active game. Host handoff and counts follow membership.
- Validate and limit signaling payloads, membership and optional destinations. Bound message size and repeated control/game events.
- Bundle the original apartment HDR lighting and fonts locally. The selected interface uses DM Sans and Phosphor icons, with included licenses. Remove the duplicate external Flowbite links. Keep the interface usable when a model fails; provide loading/WebGL/error feedback and preserve the Leave action.
- Surface join/start/round/leave failures and timeouts. Only hosts see Start; actions are disabled while disconnected. Reconnection returns to the lobby explicitly until game resume is implemented.
- Update Node, Nginx and dependencies; remove unused packages. Require reusable quality checks before image publication and deployment.

## Selected visual implementation

- A German lobby separates creating and joining a room, displays presence and provides a working invitation link with a prefilled room code.
- A desktop player rail displays actual round and total scores; an active avatar and dot mark the current turn. On phones it becomes a compact strip with expandable scores.
- The felt table, warm room lighting, image-generated avatars and card backs follow the selected direction. Existing local 3D furniture models remain real scene objects. The camera and opponent layouts adapt to viewport size and participant count.
- A persistent cue explains the current legal action. The draw pile is highlighted, and an empty pile offers a visible refill action. Shared card geometry, materials and textures and five visible stack layers reduce per-update allocations; demand rendering continues only during changes and short flips.
- Native 3D card and pile clicks work alongside an accessible HTML card grid for keyboard and touch. Hidden values stay hidden; focus in the HTML grid highlights the corresponding 3D card. Reduced-motion preferences skip animated flips.
- The 3D module loads when a game starts, keeping it out of the initial lobby bundle. Fonts, textures, HDR and furniture load from the application origin.
- Voice controls handle denied permission, shut down tracks and connections on leave/disconnect, and are limited to two players until group peer connections are implemented.

## Verification

- `npm run check` on Node 24.21.0: frontend lint, 23 backend tests and both production builds pass.
- Engine tests include malformed inputs, hidden and simultaneous triples, draw-pile refill, card conservation, complete round/scoring/next round, terminal game end and 100 game lifecycles without leftover listeners.
- Socket tests cover malformed joins, session collisions, membership, host permission/promotion, limits, presence, signaling and rate bounds.
- Independent actual Socket.IO games with two and eight participants reach the terminal score and restart successfully. More than 2,900 snapshots were checked for card conservation and valid card values. Outsider/nonhost start attempts and ninth-player joins are rejected.
- Local browser tests cover desktop and mobile game rendering, two-player join/start, host-only Start, an intentionally blocked model with visible recovery and working Leave, and reconnection returning to the lobby. The final dependency matrix renders without page errors or failed asset requests.
- Docker builds use the configured certificate trust without disabling TLS verification. Frontend copy permissions make bundled assets readable by Nginx even when the build workspace has restrictive permissions.
- A browser with two real Socket.IO peers checks a three-player game at 1487 × 1058 and 390 × 844: invite copying, initial 3D reveal, keyboard Enter reveal, native draw/discard/reveal, mobile score and card panels, and returning to the lobby. No page errors, console errors or failed requests were observed.

## Remaining work

- Stable player identity, session resume and persistence remain planned; refresh, disconnect and backend restart can still end games.
- State/request versioning is not yet implemented. Phase guards reject immediate duplicate actions; delayed coordinates from a previous state require the next protocol iteration.
- The negative-score rule is preserved pending clarification. The eight-player cap is the selected initial limit.
- Desktop/mobile screenshots use software WebGL; they do not establish frame rates on real devices or accessibility compliance.
- Group voice, TURN availability, production audio across real networks and real-device GPU performance remain unverified. Avatar/felt originals can be optimized further after delivery budgets are measured; the room uses existing models rather than claiming photorealistic equality with the generated reference.
- Runtime dependency audits are clean at this snapshot. Five high build-tool findings remain in the Tailwind 3 / braces chain, documented in `deployment.md`; those packages are absent from the frontend runtime image.
- This phase does not implement transactional public-route rollback, stack-specific deployment bundles or durable game storage.

## Preview feedback

Open https://pr-2.skylo-dev.pb-vps.org in two separate browsers or devices. Create a room and use its invitation link in the second browser. Only the host should see Start. Play initial reveals, draw/place/discard, and use "Karten bedienen" with the keyboard. Check the mobile score strip and readable turn cue. Leave and create or join another room; also try invalid/too-long room names and a room with an active game. Refresh/resume is not part of this release.
