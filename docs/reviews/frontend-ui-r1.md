# Frontend UI review, round 1 (Opus, aesthetic lead)

Screenshots reviewed: `/tmp/playtrail-shots/home-en-light-1440`, `home-en-light-390`, `detail-en-light-1440`, `detail-en-dark-1440`.

The overall direction meets DESIGN §9: the field-guide identity is clear, covers are distinct per category, trail orange is disciplined, dark mode is complete, the hero has a real focal point. The issues below must be fixed before acceptance.

## Must fix

### U1: hot snapshot row clips its first card
At scroll position 0, the edge fade mask on the horizontal list is applied to the left edge too. The first card's cover, title and summary are faded or clipped ("3it Rubble Wars", "blocky arena…" missing its first letter). Apply the left fade only after the user has scrolled (toggle via a scroll listener or a CSS scroll-driven animation with a fallback). Keep the right fade only while more content remains. The first card must start exactly on the 12-column grid's left edge.

### U2: hot position numbers collide with the category pill
The outlined position numeral sits on top of the category pill ("2" over "SIMULATION"). Move the numeral outside the cover: place it to the left of the card, overlapping the cover's left edge by no more than 30%. Alternatively, hide the category pill on hot cards (the position is the more important information there). Choose the first option.

### U3: the header category row starts with a "PLAYTRAIL" chip
The first chip reads "PLAYTRAIL" with an orange dot, which looks like a broken label. Replace it with "All games" / "全部游戏" linking to `/{locale}/games`, styled as a neutral chip with no colored dot. It shows the active state on the list page when no category is selected.

### U4: the mobile header drops the category row
DESIGN §4.1 says the category row stays (horizontally scrollable) on mobile. Restore it below 768px, at a 40px row height.

### U5: detail page repeats the field notes
The mini field-notes panel beside the cover (Developer / Devices / Source & verified) repeats the same rows in the full panel below. Remove the mini panel. Keep the right column as: category sign, name, alias, summary, tags, CTA, disclosure. Then render one line of muted metadata under the disclosure, `Verified Nov 8, 2026 · CrazyGames`, using the moss dot for verified. The full panel stays beside "About". DESIGN §6.3 is updated accordingly.

### U6: the cover letter reads as the wrong glyph
The big cropped letter shows only its left part, so "M" reads as "N" (Meadowlord). Adjust TrailCover step 5 so at least 70% of the glyph width and 60% of its height are visible: `x = 320 - 0.80*glyphWidth`, `y = 192`. Use font-size 150. Check M, W, N, T, S, Q and a digit.

## Should fix

### U7: home stats row lacks a date
Once the backend exposes `updatedAt` on `/api/home` (latest `published_at` across live games in that locale), render `UPDATED {date}` per DESIGN §6.1. Until then leave it out; do not fabricate it.

### U8: the hero collage is undersized at 1440
The five collage covers render at about 92px and leave the right column mostly empty. Use 120px covers and reduce the vertical spread so the collage fills about 80% of the hero height. Keep the stagger.

### U9: real covers (new owner decision, 2026-11-08)
Implement DESIGN §4.6 and PRD 22.12. Add a `GameCover` component used everywhere a game cover appears (cards lg/md/row, detail hero, home collage, hot list) with these properties:
- TrailCover is always underneath.
- The `<img>` carries `srcset`/`sizes` from the API `Image`, `referrerPolicy="no-referrer"` when `source === "crazygames"`, and lazy loading except for the first-viewport hero images.
- The image fades in on load and is removed on error.
- There is no layout shift.

Category pills become opaque surface with a hairline border. The detail `generateMetadata` uses `cover.shareUrl` for og:image when a cover exists; otherwise it keeps the generated opengraph-image. Do not use `next/image` for remote covers (it would proxy and rehost them through our server). Use a plain `<img>`, and add the eslint disable with a one-line reason.

## Verification
Re-take the four screenshots above plus `hot-en-light-1440`, `list-en-light-390`, and `detail-zh-light-1440`, and review them yourself against this list before reporting.
