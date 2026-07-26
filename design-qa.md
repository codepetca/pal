# Pika widget sandbox design QA

- Source visual: `/Users/stew/.codex/worktrees/pal/pika-widget/apps/web/public/assets/mockups/pika-student/pika-student-dashboard-expanded.jpg`
- Implementation screenshot: `/tmp/pal-design-qa-floating/implementation-1280x720.jpg`
- Side-by-side comparison: `/tmp/pal-design-qa-floating/comparison-1280x720.jpg`
- Focused comparison: `/tmp/pal-design-qa-floating/focused-floating-pet.jpg`
- Viewport: 1280 × 720 CSS pixels
- Source dimensions: 1280 × 720 pixels
- Implementation dimensions: 1280 × 720 pixels after normalizing the in-app browser's 0.67 display-density capture to its verified 1280 × 720 CSS viewport
- State: dark Pika host shell, expanded sidebar, Achievements selected, fixture controls collapsed, Week 4 of 16

## Evidence

- Full-view evidence: the complete Pika header, expanded navigation, full-width Pal achievement path, floating companion, and collapsed sandbox control are visible in the side-by-side comparison.
- Focused-region evidence: the lower-right comparison confirms that the compact pet floats independently over the dashboard and is not housed in a persistent right-side panel.

## Findings

- Pika shell proportions, dark palette, header, left navigation, and active state align with the supplied sandbox backdrop.
- Layout rhythm: the achievement roadmap owns the full content pane; removing the right grid track avoids making Pal depend on a Pika region that is not consistently present.
- Typography: Pika shell weights and hierarchy remain consistent with the reference; Pal retains its own roadmap hierarchy inside the host pane.
- Colors and tokens: the host continues to use the Pika-like dark surfaces, borders, muted text, and blue selected state.
- Image and icon fidelity: the supplied Pika logo, Phosphor navigation icons, and existing Pal pet asset remain sharp and correctly scaled. No substitute glyph or placeholder was introduced.
- Copy and content: Achievements remains the only added Pika destination; the roadmap and pet messaging remain Pal-owned content.
- The central content intentionally differs: the source shows Pika's Today page, while the implementation shows Pal's achievement roadmap inside the same host shell.
- The source's right-side Today content is not treated as a persistent rail. Per the clarified product direction, the implementation expands the main pane and renders the pet as an independent compact overlay.
- The fixture control remains a small overlay and does not replace or reflow the host UI.
- No P0, P1, or P2 visual issues remained after the comparison.

## Comparison history

1. Earlier implementation: P1 architecture mismatch. The companion was placed inside a faux persistent right rail, making Pal depend on a Pika layout region that is not guaranteed to exist.
2. Fix: removed the right grid track and contextual panel, expanded the roadmap across the full Pika content pane, and changed the companion to a compact lower-right overlay.
3. Post-fix comparison at 1280 × 720: passed. The focused lower-right evidence confirms the pet is independent of the main layout; no P0, P1, or P2 issue remains.

## Interaction QA

- Switched from Achievements to Today and back to Achievements.
- Confirmed the floating pet remains visible across Pika destinations.
- Opened the sandbox fixture controls.
- Triggered the fish reward and dismissed the celebration.
- Confirmed the companion changed to its excited state after the reward.
- Checked browser warnings and errors after the interaction sequence: none.

final result: passed
