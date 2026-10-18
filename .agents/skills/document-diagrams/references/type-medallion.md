# Medallion

**Best for:** documenting a multi-tier data-storage layout where each tier is a distinct *quality / access level* of the same dataset — typically raw landing zone, anonymised, staging/cleaned, aggregated business indicators, and cold archive. Used when the reader needs to see at a glance *what each bucket contains*, *who writes it*, *with what tool and format*, and *how data is promoted between tiers*.

Prefer **Process** if the subject is a workflow with role lanes. Prefer **High-Level** if the subject is the cluster architecture rather than the storage tier organisation.

This type is **parametric** — the inputs schema in §1 drives every coordinate via the formulas in §2. Two generations from the same inputs must produce visually identical SVG. The rule shapes mirror `type-process.md` and `type-data-flow.md` so color override, focal rule, and reproducibility checklist read identically across types.

---

## 1. Inputs — the parameter contract

```yaml
title:    "Five-Tier Medallion Architecture"
subtitle: "Quarterly survey through Raw → Anonymized → Staging → Aggregated → Archive"

tiers:                                # 3..6 tier columns, ordered left → right
  - { name: "Raw",        bucket: "raw-bucket",        style: "outer",
      fields: { tool: "NiFi · raw write",          format: "CSV · Parquet · JSON", writer: "Data Engineer",
                example: ["Q1 dump · w/ PII", "verbatim CAPI export"] } }
  - { name: "Anonymized", bucket: "anon-bucket",       style: "default",
      fields: { tool: "Trino INSERT",              format: "Iceberg · partitioned", writer: "Data Engineer",
                example: ["no name · address", "stable household ID"] } }
  - { name: "Staging",    bucket: "staging-bucket",    style: "default",  color: "#f59e0b",   # warm yellow — analytical working zone
      fields: { tool: "Trino · JupyterHub",        format: "Iceberg · cleaned",     writer: "Data Scientist",
                example: ["weighted records", "harmonised codings"] } }
  - { name: "Aggregated", bucket: "aggregated-bucket", style: "focal",  focal: true,
      fields: { tool: "Trino INSERT · SAS JDBC",   format: "Iceberg · indicators",  writer: "Data Scientist",
                example: ["unemployment rate", "labour participation"] } }
  - { name: "Archive",    bucket: "archive-bucket",    style: "cold",
      fields: { tool: "MinIO lifecycle",           format: "cold tier · immutable", writer: "Data Administrator",
                example: ["historical Q1–Q4 sets", "5+ years retained"] } }

example_label: "Quarterly survey example" # bottom field label (varies per domain)

promotions:                           # adjacent-tier arrows; len = n_tiers - 1
  - { from: 0, to: 1, label: "PII REMOVE",    style: "normal"    }
  - { from: 1, to: 2, label: "CLEAN+WEIGHT",  style: "normal"    }
  - { from: 2, to: 3, label: "AGGREGATE",     style: "focal"     }    # auto-accent because target is focal
  - { from: 3, to: 4, label: "LIFECYCLE",     style: "lifecycle" }    # dashed

paths:                                # 0..2 write-method cards at the bottom (optional)
  - { tag: "SQL PATH",      title: "Trino INSERT INTO … SELECT",
      sub: "filter · reshape · join · aggregate — set-based transforms" }
  - { tag: "NOTEBOOK PATH", title: "DuckDB + Python/R in JupyterHub",
      sub: "stats · ML · interactive analysis — row-iterative work" }

```

**Reserved field semantics:**
- `tiers[i].style` — one of `outer`, `default`, `focal`, `cold`. Drives the card's fill/stroke palette (§2.4).
- `tiers[i].focal: true` — exactly **one** tier may declare this. Overrides `style` to `focal` and switches the promotion arrow *into* this tier to `focal` automatically.
- `tiers[i].fields` — `{tool, format, writer, example}`. `example` is a 1- or 2-item list; the section heading uses `example_label`.
- `tiers[i].color` — optional `"#hex"` per-tier color override. See §4.
- `promotions[].style` — `normal` | `focal` | `lifecycle`. The connector rule (§3) binds each style to fixed stroke / dash / marker.
- `paths` — 0–2 entries. When 0 entries, the bottom row is omitted and `viewBox_h` shrinks accordingly.

---

## 2. Layout formulas — deterministic geometry

```
# Tier dimensions
tier_w           = 172
tier_h           = 380
tier_gap         = 16
left_pad         = 16
right_pad        = 100
n_tiers          = len(tiers)

# Canvas
viewBox_w        = left_pad + n_tiers * tier_w + (n_tiers - 1) * tier_gap + right_pad
                                                    # 5 tiers → 16 + 860 + 64 + 100 = 1040
arc_band_h       = 80                               # space above tiers reserved for promotion arcs
path_h           = 56
path_gap         = 16                               # gap between tier row and path row
bottom_pad       = 16
viewBox_h        = arc_band_h + tier_h + (path_gap + path_h if paths else 0) + bottom_pad
                                                    # with paths → 80+380+72+16 = 548
                                                    # without paths → 80+380+16 = 476

# Tier positions
tier_x(i)        = left_pad + i * (tier_w + tier_gap)    # 16, 204, 392, 580, 768
tier_y           = arc_band_h                            # 80 — tier tops sit just below the arc band
tier_cx(i)       = tier_x(i) + tier_w/2                  # 102, 290, 478, 666, 854

# Promotion arcs (between adjacent tiers — over the top, anchored at tier top-centers)
arc_src_x(i)     = tier_cx(i)                            # top-center of tier i      (102, 290, 478, 666)
arc_dst_x(i)     = tier_cx(i+1)                          # top-center of tier i+1    (290, 478, 666, 854)
arc_peak_x(i)    = (arc_src_x(i) + arc_dst_x(i)) / 2     # midpoint                  (196, 384, 572, 760)
arc_label_y      = 50                                    # label sits inside the arc, 30px below tier top

# Path row (bottom)
path_y           = tier_y + tier_h + path_gap            # 476
path_w           = (viewBox_w - 2*left_pad - path_gap) / 2 if len(paths) == 2 else (viewBox_w - 2*left_pad)
                                                          # Canonical 5-tier shape uses path_w=460 explicitly (see §2.5)
```

### 2.1 Background

Solid paper fill across the full viewBox. No dot pattern.

### 2.2 Tier card (172 × 380)

Each tier renders as a rounded-rect card with a tinted header band, a centered bucket name, four labeled field rows, and a separated `example_label` section near the bottom.

```
tier_x(i),  tier_y       =  card top-left  (tier_y = 80, just below the arc band)
header_band_h            = 40            # band from y=tier_y to y=tier_y+40 (i.e., 80..120)
header_band_extra        = 10            # 10-px extension below band, same tint

# Inside the card (absolute y; tier_y = 80):
title_text            at (tier_cx(i), 106)                # node-name role, 13px, weight 700, ink
bucket_text           at (tier_cx(i), 144)                # sublabel role, muted (accent on focal tier)

field_x               = tier_x(i) + 16                    # 16-px left inset for field text
field_w               = 140                               # 172-px tier_w minus two 16-px insets
field rows (absolute y):
  tool_label  at 180,    tool_value  at 186 (text/tspan, measured two-line height)
  format_label at 220,   format_value at 226 (text/tspan, measured two-line height)
  writer_label at 260,   writer_value at 266 (text/tspan, measured two-line height)
  # gap (open whitespace below writer row, above the example section)
  example_label_text at 360,  example_line_0 at 374,  example_line_1 at 388
```

**Field-value wrapping rule:** use native SVG `<text>` and one `<tspan>` per measured line. Keep the full field value; when it exceeds 140px, split at word or CJK boundaries into at most two lines. Use 10px secondary text with a 13px line step, and expand the field row and following baselines if necessary. Never embed an HTML element or foreignObject.

```xml
<text x="field_x" y="field_y" fill="{muted}" font-size="{secondary-size}">
  <tspan x="field_x" dy="0">First line</tspan>
  <tspan x="field_x" dy="13">Second line</tspan>
</text>
```

Field labels use the `node-name` role at 12px in ink. Field values use the `sublabel` role in muted. Bucket and field values can be retinted by `color` override (§4).

### 2.3 Tier styles

Four canonical styles, picked per tier via `tiers[i].style`. Default mapping if `style` is omitted: tier 0 → `outer`, last tier → `cold`, focal tier (if any) → `focal`, others → `default`.

| `style` | Card fill | Card stroke | Header band fill | Bucket text | Example value text |
|---|---|---|---|---|---|
| `outer` | `role-fill` | `role-stroke` 1.0 solid | `role-fill` | `role-text` | `role-text` |
| `default` | `role-fill` | `role-stroke` 1.0 solid | `role-fill` | `role-text` | `role-text` |
| `focal` | `role-fill` | `role-stroke` 1.6 solid | `role-fill` | `role-text` | `role-text` |
| `cold` | `role-fill` | `role-stroke` 1.0 dashed `5,3` | `role-fill` | `role-text` | `role-text` |

`rx = 6` on all card rects.

**Focal styling note:** retain the tier's semantic surface and dark role text; the 1.6px outline provides emphasis. Keep all field values legible.

### 2.4 Promotion arcs (over the top of the tiers)

Each promotion is a **cubic Bézier arc** anchored at the **top-center** of each adjacent tier — `(tier_cx(i), tier_y)` to `(tier_cx(i+1), tier_y)`. The arc rises into the 80-px `arc_band` above the cards, peaking at y ≈ 20. Both the connector and its label remain fully visible — no paper masks, no overlap with card content.

```svg
<path d="M {tier_cx(i)},{tier_y} C {tier_cx(i)},0 {tier_cx(i+1)},0 {tier_cx(i+1)},{tier_y}"
      fill="none" stroke="…" stroke-width="…" marker-end="…"/>
```

Concrete for the canonical 5-tier shape (`tier_y = 80`, tier centers at x = 102, 290, 478, 666, 854):
- 0→1: `M 102,80 C 102,0 290,0 290,80`
- 1→2: `M 290,80 C 290,0 478,0 478,80`
- 2→3: `M 478,80 C 478,0 666,0 666,80`  (focal — accent)
- 3→4: `M 666,80 C 666,0 854,0 854,80`  (lifecycle — dashed)

The cubic geometry: anchor y = 80 (tier top), control y = 0 (top of viewBox). Curve peak at t=0.5 sits at y ≈ 20 (computed from `0.125·80 + 0.375·0 + 0.375·0 + 0.125·80 = 20`). Each arc spans one full tier-stride (188 px on the canonical layout), giving the connector a clearly visible vertical excursion.

**Marker orientation:** `marker-end` with `orient="auto"` rotates the arrow to match the path tangent at the endpoint. The control point sits directly above the anchor so the tangent at landing is straight **down** — the arrowhead enters the top-center of tier *i+1* cleanly, pointing into the header band.

**Chained anchors:** consecutive arcs share their meeting points (arc 0→1 ends at the same `(tier_cx(1), 80)` where arc 1→2 begins). Visually each tier's top-center acts as a "joint" — data arrives at the top of the card, gets transformed inside, and leaves out the top toward the next tier. The arrow-head plunge plus the next arc's straight-up emergence read as a single payload-handoff motion.

| `style` | Stroke | Width | Dash | Marker |
|---|---|---|---|---|
| `normal` | `muted` | 1.4 | — | `arrow` |
| `focal` | `accent` | 1.6 | — | `arrow-accent` |
| `lifecycle` | `muted` | 1.4 | `4,3` | `arrow` |

**Auto-style rules:**
- If `promotions[k].to` references the **focal tier**, the style auto-promotes to `focal` (accent, width 1.6, `arrow-accent` marker).
- Choose promotion colors by relationship meaning (processing, output or neutral), with a matching marker. Width stays at 1.4 unless focal; lifecycle arrows keep their dash. A tier's component color does not automatically recolor its edges.
- A focal promotion keeps its semantic hue and uses width 1.6. The focal paint slot resolves to that hue; it does not overwrite it with blue.

**Label inside the arc:**
- Anchored at `(arc_peak_x(k), arc_label_y)` = `((arc_src_x + arc_dst_x) / 2, 50)`.
- `arrow-label` role at 10px with normal letter spacing. Color matches the arrow stroke.
- **No mask rect needed** — the cubic curve peaks at y ≈ 20 and the label sits at y=50, well below the curve. The label floats inside the open space *enclosed* by the arc, reading "X transforms into Y" with the arc itself as the visual frame.

For shorter inter-tier gaps (if `tier_gap` is overridden below the default 16 px), the arc anchors `arc_inset` may need to shrink correspondingly to keep the arc visible.

### 2.5 Path row (bottom, optional)

Up to **2** write-method cards. The canonical 5-tier shape (with `arc_band_h = 80`):

```
path_y      = 476       # tier_y + tier_h + path_gap = 80 + 380 + 16
path_h      = 56
path_x[0]   = 16
path_w[0]   = 460
path_x[1]   = 16 + 460 + 16 = 492
path_w[1]   = 460
```

(Both paths land 460-wide despite the viewBox being 1040 — the right pad is taken from the card's tier strip, not the path strip. Keep `path_w=460` for the canonical 5-tier shape. For other tier counts, derive `path_w = (viewBox_w - 2*left_pad - path_gap) / 2`.)

Per-card content:
- Container rect: white fill, `ink @ 0.20` stroke width 1, `rx=6`.
- Tag chip: rect at `(path_x + 8, path_y + 6)`, `h=12 rx=2`, fill transparent, stroke `ink @ 0.30` width 0.8. Tag text centered inside in the `eyebrow` role with normal letter spacing, ink.
- Title at `(path_x + 80, path_y + 30)`: `node-name` role at 12px, ink.
- Sub at `(path_x + 80, path_y + 46)`: `sublabel` role, muted.

---

## 3. Connector rules (mandatory)

Three styles, bound to topology. Mirror §3 of `type-process.md` so the rule reads identically.

```svg
<defs>
  <marker id="arrow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="{muted}"/></marker>
  <marker id="arrow-accent" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="{accent}"/></marker>
  <!-- Per-color markers: declare one per custom tier color in use. -->
  <marker id="arrow-yellow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="#f59e0b"/></marker>
</defs>
```

Add a new `<marker>` for each `color` override used in the diagram. Naming convention: `arrow-{semantic}` (e.g., `arrow-yellow`, `arrow-slate`, `arrow-red`) — matches the recommended palette so the marker id reads cleanly in source.

**Z-order:** promotion arcs draw **before** any tier card rect, so the cards layer on top and any arc overshoot is masked inside the cards.

**Arc shape rule:** medallion promotions are always **cubic arcs over the top** of the tier strip, anchored at the **top-center** of source and target tiers; control points directly above anchors at y=0. No horizontal "through the gap" lines — the arc-over-top is what makes connector + label both clearly visible.

---

## 4. Visual values

Use [visual-style.md](visual-style.md) for colors, fonts, sizes and markers. Optional color inputs select a semantic role for any component, including a focal one; they do not change node roles, relationship kinds or layout formulas.

## 5. Focal rule

Use the semantic role fill/stroke/dark-text triple from visual-style.md on both ordinary and focal nodes. Keep the stated focal count and emphasize those nodes with border weight; role colors do not consume focal slots.

Exactly **one** focal tier per diagram. Defaults to the tier marked `focal: true` in inputs; if none is marked, defaults to the analytical pivot tier (typically `Aggregated` or whichever tier downstream consumers query).

The focal tier:
- Uses `style: focal` (role fill + stroke 1.6 + semantic header band).
- Renders bucket text and example-value lines in dark semantic text.
- Has its **incoming** promotion arrow auto-promoted to `style: focal` (accent).
- Has its **outgoing** promotion arrow (if any) — typically into the cold archive — kept at the user-declared style (usually `lifecycle` dashed).

If zero or >1 tiers carry `focal: true`, halt and ask the user.

---

## 7. Reproducibility checklist (taste gate)

Before emitting SVG, verify **every** item:

1. `viewBox = "0 0 {viewBox_w} {viewBox_h}"` derived via §2 (5 tiers + 2 paths → 1040 × 548).
2. Each tier card at `(tier_x(i), 80)` size `172 × 380`, `rx=6`.
3. Tier header band fills `(tier_x(i), 80, 172, 40)` plus a 10-px extension under the band.
4. Exactly **one** focal tier; its incoming arc auto-styled to `focal`.
5. Promotion arcs render as cubic Béziers over the top of adjacent tiers; anchors at `(tier_cx(i), 80)` → `(tier_cx(i+1), 80)`, controls at y=0. Label inside the arc at `(arc_peak_x, 50)`, no mask.
6. Bottom path row only present when `len(paths) > 0`. Cards at `y=476`, height 56.
7. Apply semantic role colors consistently, including on non-focal components; role colors do not consume focal slots.
8. All promotion arrows + label masks emitted **before** any tier rect (z-order rule — cards mask the line ends inside the cards).
9. All tiers use readable dark semantic text; the focal tier retains its heavier outline.
10. `rx=6` on every tier and path card; `rx=2` on tag chips.

---

## 8. Anti-patterns

- **More than one focal tier** — focal exists to mark the central analytical surface; >1 erases the signal.
- **Cold styling on a non-archive tier** — the dashed fog look is reserved for retention/archive tiers.
- **Bidirectional promotion arrows** — promotions always flow left → right. Backflow (e.g., an aggregate writing back to raw) is wrong for this type; use a different diagram.
- **Custom-colored arrows** — connectors are topology-driven; color on a tier never spreads to its edges.
- **Path cards explaining tier semantics** — paths describe *write methods* (how data moves between tiers), not what each tier holds. If you find yourself writing "Raw stores …" in a path card, that content belongs in the Raw tier's fields.
- **Missing `example_label` content** — every tier should show a concrete example payload (quarterly survey rows, customer records, claims, …). Without it the diagram becomes abstract and stops earning its space.
- **Promotion arrow label longer than the tier-gap label mask** — keep labels to ≤ 14 chars in the `arrow-label` role. Long verbs ("CALCULATE & SUMMARIZE") break the rhythm; shorten to "AGGREGATE" or split into two diagrams.

---

## 10. Worked YAML

The YAML in §1 is the **complete** input definition. Derive coordinates from §2 and retain these inputs in an XML comment in the generated SVG for reproducibility.
