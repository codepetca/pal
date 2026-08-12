# Reversed achievement trail design QA

- Source visual truth: `/Users/stew/.codex/generated_images/019fee04-dfa0-7e10-b55f-b955be5152f4/exec-2f80015e-8db8-4da3-90d2-749d5a206d4d.png`
- Browser-rendered implementation: `/tmp/pal-achievement-reverse/refined-css1440-atlas.png`
- Normalized implementation evidence: `/tmp/pal-achievement-reverse/implementation-final-1440x923.png`
- Full comparison: `/tmp/pal-achievement-reverse/comparison-full.png`
- Focused comparison: `/tmp/pal-achievement-reverse/comparison-css1440-upper.png`
- Viewport: 1440 × 1023 CSS pixels at device pixel ratio 0.67
- Source dimensions: 1440 × 1024 pixels
- Implementation capture dimensions: 1440 × 1023 pixels
- State: dark Pika shell, expanded navigation, Achievements selected, current Week 5 with four past weeks and 2 of 4 Weekly Rhythm days

## Capture normalization

The in-app browser's 0.67-density raster capture repeats the visible surface when
the viewport override is active. The browser-rendered file is retained above.
The upper achievement region was normalized from its first visible frame for the
focused comparison, while DOM measurements and a lower scroll state verified the
complete trail. The one-pixel source/implementation height difference is ignored.

## Evidence

- Full-view evidence: the Pika header, navigation, selected Achievements state,
  current goal, descending trail, existing companion overlay, and collapsed
  sandbox control remain in their host-owned positions.
- Focused evidence: each desktop week row places its label and real badge assets
  on one horizontal axis. The blue numbered marker identifies the current week.
- DOM evidence: visible week order was Week 5, Week 4, Week 3, Week 2, Week 1.
  Future-week element count was zero. The trail ended at Week 1.
- Responsive evidence: at 389 × 843 CSS pixels, the document, main surface, and
  achievement surface had equal client and scroll widths. Week labels and badge
  rows stack at the host's narrow viewport without horizontal overflow.

## Findings

- Fonts and typography: the implementation preserves the host's Inter-like UI
  family and recreates the selected hierarchy with a 2 rem page title, 1.5 rem
  current-week label, 1.25 rem past-week labels, and compact supporting text.
- Spacing and layout rhythm: desktop rows use a consistent label column followed
  by a wrapping horizontal badge strip. The connector runs from the current
  marker and ends at Week 1. No disabled or teaser step extends the trail.
- Colors and tokens: the page continues to consume the existing Pika-to-Pal
  semantic bridge for navy surfaces, blue current state, green earned state,
  muted text, borders, focus styling, and dark/light themes.
- Image quality and asset fidelity: Weekly Rhythm and login/check-in outcomes now
  use the repository's real PNG badge art. Existing Pika, Phosphor, and Pal pet
  assets remain unchanged; no new placeholder drawing was introduced.
- Copy and content: persistent copy is reduced to `Achievements` and week labels.
  Badge name plus status/progress appears only on badge hover or keyboard focus.
  Descriptions, rewards, dates, the `This week` chip, semester subtitle and
  denominator, and all future-week copy are gone.
- The live comparison uses Week 5 while the selected mock uses Week 4. This is an
  intentional data-driven value; the hierarchy and ordering are the matched
  design behaviors.
- No actionable P0, P1, or P2 findings remain.

## Comparison history

1. Initial implementation: P1 asset mismatch from glyph badge fallbacks and P2
   density mismatch from compressed past-week rows.
2. Fixes: mapped supported achievements to existing PNG assets, enlarged the
   current badge/card, stacked earned labels, and increased past-row height.
3. Post-fix comparison: real badges render sharply, the current week remains the
   dominant stop, and completed weeks read as a deliberate descending trail.
4. Requested refinement: badges now sit horizontally beside every desktop week;
   the current-week chip was removed and replaced by the existing blue marker.

## Interaction QA

- Navigated from Achievements to Today and back to Achievements.
- Confirmed the same data-driven current/past state returned after navigation.
- Verified zero future-week elements before and after navigation.
- Verified five desktop badges share the same top coordinate as the Week 1 label
  and advance horizontally with consistent spacing.
- Verified badge focus exposes `First Pika Login — Earned`; the same tooltip is
  exposed on hover, and the focus target has the full accessible label.
- Verified the hover disclosure remains visible while the pointer moves from the
  badge across its bridge and onto the tooltip content.
- Verified the narrow host viewport has no horizontal overflow.
- Checked browser warnings and errors after the interaction sequence: none.

## Follow-up polish

- P3: the browser capture's density tiling makes the saved full-frame comparison
  less clean than the live preview, but does not affect the rendered page.

final result: passed
