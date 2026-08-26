# A Place to Call Home — Story Collection Design

## Current product contract

`A Place to Call Home` v1 is the default story for every newly created term of
16–24 academic weeks. It always contains exactly 16 story chapters and offers
one story reward per chapter. Academic terms may continue after the story:
Week 17 and later keep their normal roadmap and achievement behavior, but they
do not schedule, grant, or display another story reward.

Terms shorter than 16 weeks continue to use the registered elastic
`Pip's First Recipe` v1 catalog. A story plan is pinned when its term is first
configured. Changing the default never rewrites an existing learner's plan,
including older Pip plans with story chapters after Week 16.

## Reward categories and use

The current schema has three story-reward categories:

- `companion`: a character the learner can equip in the pet widget. At most one
  companion is equipped at a time; an empty slot hides the pet widget.
- `wallpaper`: a background the learner can equip on the Achievements page.
  Exactly one wallpaper is equipped at a time. Each wallpaper has real light
  and dark artwork.
- `keepsake`: collectible art shown when earned and retained in the story
  progression. It has no equipment slot in this implementation.

Companion and wallpaper reveals offer **Use now** and **Save for later**.
On the Achievements page, each owned companion or wallpaper reward is itself a
toggle button: selecting it equips that reward, selecting a different reward
replaces the slot, and selecting the active reward clears the custom choice.
Clearing a wallpaper restores the themed page background. Clearing a companion
leaves the slot empty and hides the pet. Equipping any owned companion makes it
visible again. Keepsakes retain the existing reveal-and-continue flow. The
narrative may show Pip and Lumi together, but the pet widget displays at most the
single active companion.

## The 16-scene catalog

| Week | Reveal heading | Reward | Category | Bonus title | Production asset |
| ---: | --- | --- | --- | --- | --- |
| 1 | A New Adventure | Trusty Lantern | keepsake | — | `reward-warming-lantern-v1.png` |
| 2 | Dusty Discovery | Strange Egg | keepsake | — | `reward-mystery-egg-v1.png` |
| 3 | Keeping warm | Makeshift Bed | keepsake | — | `reward-makeshift-bed-v2.png` |
| 4 | Room for One More | Pip | companion | — | `young-pip-v1.png` |
| 5 | Flour prints | Flour Bag | keepsake | — | `reward-flour-bag-v1.png` |
| 6 | Unmeasured | Measuring Cup | keepsake | — | `reward-measuring-cup-v1.png` |
| 7 | Undeterred | Fresh Bread | keepsake | Undeterred | `reward-fresh-bread-v1.png` |
| 8 | Courtyard | Courtyard Afternoons | wallpaper | — | `wallpaper-courtyard-afternoons-v4.png` |
| 9 | Pantry Thief | Bitten Bread | keepsake | — | `reward-bitten-bread-v1.png` |
| 10 | Care | Care Kit/Bandages | keepsake | — | `reward-bandages-v1.png` |
| 11 | New Friend | Lumi | companion | Gentle Friend | `lumi-v1.png` |
| 12 | Something Sweet | Cookie Plate | keepsake | — | `reward-round-cookie-v1.png` |
| 13 | Moving beyond | The Stream Beyond | wallpaper | — | `wallpaper-stream-beyond-v16.png` |
| 14 | The Path | Stepping Stones | keepsake | — | `reward-stepping-stone-v1.png` |
| 15 | Job done | Stream Picnic | keepsake | Pathmaker | `reward-picnic-basket-v2.png` |
| 16 | Epilogue | New Egg | keepsake | Homekeeper | `reward-new-egg-v1.png` |

The canonical rendered gallery is
[`docs/assets/a-place-to-call-home-collectibles.png`](assets/a-place-to-call-home-collectibles.png).

## Story and visual requirements

- Scene 8 is about being happy with Pip and watching birds fuss around the
  courtyard. It does not describe Pip growing bigger and includes no ball.
- Scene 15's basket is open, with bread and cookies visible inside.
- The Makeshift Bed is blue-and-white cloth arranged in a low oval basket, not
  a finished conventional bed.
- Props throughout the story use restrained blue-and-white cloth and color
  continuity.
- Wallpapers use minimal, distinct line art. Courtyard Afternoons shows a
  rustic cottage edge, simple gate, low wooden fence, rolling countryside, and
  distant woods without enclosing walls. The Stream Beyond shows a short,
  irregular handmade stone path from the viewer's perspective to a small,
  winding wooded brook and picnic clearing; the trail does not continue beyond
  the water and no stones sit in the stream.
- Wallpaper light and dark files are separate authored variants, not runtime
  inversion or tinting.
- Artwork must remain legible at its real UI size, preserve sufficient contrast
  in both themes, and never encode the reward name only in the image.

## Persistence and compatibility

The registry is keyed by `(story ID, story version)`. Chapter, collectible, and
title IDs are durable. Once assigned, changes to narrative, order, art identity,
or reward behavior require a new story version.

Story ownership is append-only. Equipped state is separate and mutable:
ownership answers “what has this learner earned?” while the loadout answers
“which owned companion and wallpaper are active now?” A learner cannot equip
another learner's grant, a keepsake, or more than one reward in a slot.

Locked roadmap entries conceal future story names, copy, and art. When a story
ends before its academic term, later roadmap weeks have no fabricated locked
story slot. Ordinary achievements continue normally.
