# Design QA: selected variant 3

## Comparison target and normalization

- Source truth: [selected-variant-3.png](docs/design/selected-variant-3.png), the third displayed generated image selected by the user.
- Implementation: [desktop](docs/design/implementation-desktop.png) and [mobile](docs/design/implementation-mobile.png), captured from the running application in Chromium with software WebGL.
- Source and desktop screenshot: **1487 × 1058 pixels**, CSS viewport **1487 × 1058**, device scale factor **1**. Mobile: **390 × 844**, device scale factor **1**. No browser chrome, device frame or density mismatch. Final comparison captures use reduced motion to show stationary cards; ordinary-motion gameplay was tested separately.
- Route/state: a real three-player game, dark theme, current browser player's draw turn, invitation closed. No fabricated game data, names or scores. Two Socket.IO clients supply the other participants.
- The reference has twelve personal cards revealed during a draw prompt. This is inconsistent with initial play. The implementation shows its actual revealed cards and hides unknown values. Opponents may have played a legal turn before the browser player's turn. Card values, revealed counts and points therefore intentionally differ.
- Actual participants are "Du" and "Spieler N"; editable names and profile photos are future work. The microphone is off and disabled for this three-player state because only two-party voice is supported.

## Evidence reviewed together

- Full view: [final side-by-side comparison](docs/design/comparison-final.png). Both images are displayed in the same browser-rendered comparison input at identical source scale.
- Focused, original-scale regions: [player rail](docs/design/comparison-rail.png) and [cue/cards](docs/design/comparison-cue.png). These were necessary to judge small score text, turn markers, card imagery and draw affordance.
- First comparison: [initial side-by-side comparison](docs/design/comparison-initial.png). Its implementation is the initial two-player reveal phase; differences in participant count and game content were excluded from findings. The layout, typography and lighting were still inspectable.
- Local detailed evidence: `/workspace/skylo-analysis/variant-3/`, including `browser-evidence.json`, `visual-evidence.json`, expanded mobile score/card screenshots and production browser evidence.

## Findings and comparison history

1. **[P1, fixed] Cards intersected the felt surface.** The initial rounded felt radius exceeded half its thickness. The radius is now 0.035, with card surfaces above the table. Desktop/mobile recaptures show all personal cards and piles clearly.
2. **[P2, fixed] Room lighting and lamp proportions diverged.** The first comparison showed a bright floor and oversized, cropped lamp. Room material/light intensity was reduced, the lamp was resized and moved, and a separate table light restored the cool teal playing surface. The final comparison retains readable cards with a darker surrounding room.
3. **[P2, fixed] Scores were too small and the turn dot clipped.** Scores changed from 14 to 16 px, player names to 18 px, avatars to 70 px; rail spacing and overflow padding were corrected. The focused final rail comparison shows the visible active dot and readable score lines. Mobile keeps its own compact typography.
4. **[P2, fixed] The persistent draw affordance was too faint.** The active stack has a wider opaque cyan border; the cue uses a Phosphor caret. The final cue comparison shows both the instruction and the actionable pile. An empty draw pile now offers a real "Mischen" slot instead of disappearing.
5. **[P2, fixed] Slow rendering could prolong a card flip.** Easing now uses actual elapsed frame time instead of limiting it to 40 ms. Final stationary captures use the supported reduced-motion setting; ordinary-motion native actions passed without browser errors.
6. **[P2, fixed] Voice negotiation failed with simultaneous or delayed microphone activation.** Deterministic host/guest roles, repeated host offers, duplicate-offer suppression and stale-peer guards resolve these cases. Independent browser probes pass host-first, guest-first and simultaneous activation. Turning voice off ends tracks and closes connections. This verifies signaling/lifecycle, not real network audio quality.

## Required fidelity surfaces

| Surface | Final evaluation |
| --- | --- |
| Fonts and typography | Local DM Sans closely follows the source's rounded sans-serif hierarchy. The 36 px wordmark, 18 px names, 16 px scores and 21 px cue title are clear; no unintended truncation or missing glyphs. Small mobile text uses a separate compact hierarchy. |
| Spacing and layout | The 236 px rail, large personal 4×3 grid, opponent grids, central piles and top-right controls follow the selected composition. The real camera keeps content centered in its remaining viewport; the source's exact camera perspective is not claimed. Mobile has a 142 px header/score strip, separate camera framing and accessible panels, with no horizontal overflow or hidden persistent controls. |
| Colors and tokens | Dark background, muted white text, cyan current-turn/action accents, warm wood and cool teal felt follow the source palette. Table illumination was adjusted from measured screenshots. Bloom and photographed room grading are not reproduced. |
| Image quality and assets | Generated portraits, felt and patterned card back match the chosen direction and load locally. Existing card faces and furniture are real assets; standard icons are Phosphor. The table/cards remain interactive 3D objects. Existing furniture and simpler room geometry intentionally preserve the application's scene rather than replacing it with the source screenshot. |
| Copy and content | German lobby, invitation, round/total scores and action cues are consistent. "Ziehe eine Karte oder nimm die Ablage" includes both legal choices. Messages and end results use actual server state. Hidden values and fake names/scores from the mock are never substituted. |

## Primary interactions checked

- Create/join controls, waiting presence and copied invitation with the correct room query.
- A native 3D card click reveals the intended card; Enter on the HTML card grid reveals the second card.
- Actual draw, discard and subsequent reveal through 3D raycasting.
- Mobile score expansion, card panel, no horizontal overflow, and leaving to a usable lobby.
- An intentionally blocked lazy scene module produces a visible error while the score rail, card controls and Leave remain usable; leaving restores the invitation's join lobby.
- No page errors, console errors or failed requests in the final gameplay browser run. Backend regression and session tests pass; runtime dependency audits are clean.

## Accepted differences and follow-up polish

- **P3:** The generated reference is more photorealistic than the retained furniture and room models. Higher-quality furniture, floor/rug dressing, rounded card bodies and subtle bloom can be a later visual iteration. This release follows the selected composition and direction; it does not claim pixel-identical reproduction.
- **P3:** Measure real-device rendering and loading before setting budgets and optimizing the generated PNG assets. Software WebGL screenshots establish rendering and controls, not target-device frame rates.
- Resume after refresh, durable storage, group voice and TURN remain separate roadmap items. Voice audio over real networks remains unverified because this environment supplies no ICE candidates.

## Implementation checklist

- [x] Open source and rendered implementation, normalize viewport/density/state.
- [x] Compare full views and readable focused regions together.
- [x] Evaluate all five fidelity surfaces.
- [x] Fix actionable P0/P1/P2 findings and recapture/recompare.
- [x] Test core interactions and inspect browser errors.

final result: passed
