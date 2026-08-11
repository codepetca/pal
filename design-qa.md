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
- Focused evidence: the current week leads with one outlined goal surface; past
  weeks descend vertically with compact labels and real badge assets.
- DOM evidence: visible week order was Week 5, Week 4, Week 3, Week 2, Week 1.
  Future-week element count was zero. The trail ended at Week 1.
- Responsive evidence: at 389 × 843 CSS pixels, the document, main surface, and
  achievement surface had equal client and scroll widths. The 238 px current
  card fit without horizontal overflow.

## Findings

- Fonts and typography: the implementation preserves the host's Inter-like UI
  family and recreates the selected hierarchy with a 2 rem page title, 1.5 rem
  current-week label, 1.25 rem past-week labels, and compact supporting text.
- Spacing and layout rhythm: current content is expanded; past rows use a steady
  7.5 rem rhythm. The connector runs from the current marker and ends at Week 1.
  No disabled or teaser step extends the trail.
- Colors and tokens: the page continues to consume the existing Pika-to-Pal
  semantic bridge for navy surfaces, blue current state, green earned state,
  muted text, borders, focus styling, and dark/light themes.
- Image quality and asset fidelity: Weekly Rhythm and login/check-in outcomes now
  use the repository's real PNG badge art. Existing Pika, Phosphor, and Pal pet
  assets remain unchanged; no new placeholder drawing was introduced.
- Copy and content: the page is reduced to `Achievements`, semester label, week
  label, `This week`/`Earned`, achievement name, and progress. Descriptions,
  rewards, date labels, semester denominator, and all future-week copy are gone.
- The live comparison uses Week 5 and `Achievement semester`, while the selected
  mock uses Week 4 and `Fall semester`. These are intentional data-driven values;
  the hierarchy and ordering are the matched design behaviors.
- No actionable P0, P1, or P2 findings remain.

## Comparison history

1. Initial implementation: P1 asset mismatch from glyph badge fallbacks and P2
   density mismatch from compressed past-week rows.
2. Fixes: mapped supported achievements to existing PNG assets, enlarged the
   current badge/card, stacked earned labels, and increased past-row height.
3. Post-fix comparison: real badges render sharply, the current week remains the
   dominant stop, and completed weeks read as a deliberate descending trail.

## Interaction QA

- Navigated from Achievements to Today and back to Achievements.
- Confirmed the same data-driven current/past state returned after navigation.
- Verified zero future-week elements before and after navigation.
- Verified the narrow host viewport has no horizontal overflow.
- Checked browser warnings and errors after the interaction sequence: none.

## Follow-up polish

- P3: the browser capture's density tiling makes the saved full-frame comparison
  less clean than the live preview, but does not affect the rendered page.

final result: passed
