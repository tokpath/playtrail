# Admin UI review, round 1 (Opus)

Screenshots: `/tmp/playtrail-shots/admin/{overview,game-edit,source-drawer}-light-1440.png`. Walkthrough results come from the implementer's report.

Accepted overall: same token system, sensible density, the gate checklist is live and readable, the 409 dialog never overwrites, and the source-catalog drawer carries the copyright notice. Fix these in the final-review round:

- **A1** Game edit status strip shows the raw field name `REVISIONVERSION 8`. Render it as `版本 8`. Never show API field names in UI copy. The same applies to gate failure messages (`locales.en.contentReview: not approved`): map known gate fields to Chinese labels (e.g. `English · 内容审核未通过`) and fall back to the raw text only for unknown fields.
- **A2** Source drawer shows raw `false` / `true`. Render booleans as `是` / `否`, and missing values as `—`.
- **A3** Source catalog rows for sitemap-only entries repeat the slug as the name and fill every column with dashes. Show the slug once, plus a muted `未抓取详情` pill, and sort or filter so that entries with details are easy to find (the `detail` filter exists; default it to `有详情` when the result is non-empty).
- **A4** Overview has no crawler status, although `/admin/dashboard` returns it. Add a card: switch state (including an auto-disabled reason in signal color), today's quota use, and the last run per task with its outcome. Make the six count cards links to the matching filtered list.
- **A5** Once `GET /api/admin/media/{id}` exists, show existing assets as real thumbnails instead of neutral placeholder boxes.
