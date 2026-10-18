# Data Flow

**Best for:** visualising how data moves through a pipeline *across organisational roles* — who initiates, who processes, who publishes, and who consumes. The canonical use case is a multi-role data platform (Admin → Engineers → Scientists → Consumers) with 4–6 process steps. Use when the reader needs to understand **who does what at each stage**, not just the technical components.

Prefer standard **Swimlane** for cross-functional business processes (HR approvals, support tickets). Use **Data flow** when the subject is a data pipeline with typed payloads (raw files, tables, reports) and role-scoped access boundaries.

This type is **parametric** — the inputs schema in §1 drives every coordinate via the formulas in §2. Two generations from the same inputs must produce visually identical SVG.

---

## 1. Inputs — the parameter contract

```yaml
lanes:                              # 1..4 horizontal swimlanes (top to bottom)
  - { name: ["DATA", "ADMINS"],     key: "ADM" }
  - { name: ["DATA", "ENGINEERS"],  key: "ENG" }
  - { name: ["DATA", "SCIENTISTS"], key: "SCI" }
  - { name: ["DATA", "CONSUMERS"],  key: "CON" }

steps:                              # 1..6 columns (left to right)
  - { number: "01", label: "COLLECT" }
  - { number: "02", label: "STORE" }
  - { number: "03", label: "TRANSFORM" }
  - { number: "04", label: "ANALYZE",  focal: true }   # focal step header chip — accent fill
  - { number: "05", label: "PUBLISH" }

nodes:                              # explicit per-cell entries; empty cells render nothing
  - { lane: "ADM", step: 0, title: "Project Setup",   sub: "create · assign roles",     tool: "Platform console" }
  - { lane: "ADM", step: 1, title: "Access Control",  sub: "bucket policies · LDAP",    tool: "MinIO · LDAP console",
      color: "#ec4899" }            # tinted pink to flag governance/identity concern
  - { lane: "ENG", step: 0, title: "Source Ingest",   sub: "ext. sources → raw",        tool: "NiFi · API · SFTP",
      chips: {in: "WB", out: "DB"} }                    # web payload in, dataset out
  - { lane: "ENG", step: 1, title: "Raw Store",       sub: "raw landing zones",         tool: "MinIO raw",
      chips: {in: "DB", out: "DB"} }                    # raw stays raw inside the landing zone
  - { lane: "ENG", step: 2, title: "Clean & Stage",   sub: "raw → staging → anon",      tool: "NiFi · Trino",
      chips: {in: "DB", out: "TB"} }                    # raw dataset → analysis-ready table
  - { lane: "SCI", step: 3, title: "Explore & Model", sub: "anon data → insights",      tool: "JupyterHub · Trino",
      chips: {in: "TB", out: "FL"}, focal: true }       # focal — table in, file/report out
  - { lane: "SCI", step: 4, title: "Publish Findings", sub: "models → dashboards",      tool: "Superset · Reports",
      chips: {in: "FL", out: "FL"} }                    # report in, report out (pass-through to publish)
  - { lane: "CON", step: 4, title: "Query Insights",   sub: "aggregated views",         tool: "Trino (read-only)",
      chips: {in: "TB", out: "TB"} }                    # consumers read tables, hand off tables

arrows:                             # explicit edges; styles bind to topology (see §3)
  - { from: {lane: "ADM", step: 0}, to: {lane: "ADM", step: 1}, style: "muted" }
  - { from: {lane: "ADM", step: 0}, to: {lane: "ENG", step: 0}, style: "trigger" }   # dashed governance
  - { from: {lane: "ADM", step: 1}, to: {lane: "ENG", step: 1}, style: "trigger" }
  - { from: {lane: "ENG", step: 0}, to: {lane: "ENG", step: 1}, style: "muted" }
  - { from: {lane: "ENG", step: 1}, to: {lane: "ENG", step: 2}, style: "muted" }
  - { from: {lane: "ENG", step: 2}, to: {lane: "SCI", step: 3}, style: "accent",     # focal cross-role
      label: "anon data" }
  - { from: {lane: "SCI", step: 3}, to: {lane: "SCI", step: 4}, style: "muted" }
  - { from: {lane: "SCI", step: 4}, to: {lane: "CON", step: 4}, style: "link" }     # teal: published

```

**Reserved field semantics:**
- `lanes[k].key` — the 3-letter role chip text (e.g., `ADM`, `ENG`, `SCI`, `CON`). Used inside every node in that lane.
- `lanes[k].name` — two-line lane label; both lines use the `eyebrow` role.
- `steps[j].focal: true` — exactly **one** step may declare this. Header chip renders in accent.
- `nodes[i].focal: true` — exactly **one** node may declare this. Renders with accent border (§5).
- `nodes[i].chips` — data-type chips for the node. Either form accepted:
  - **Object form (preferred):** `{in: "<CODE>", out: "<CODE>"}` — explicit input/output semantic. Either side optional.
  - **Array form:** `["<INPUT_CODE>", "<OUTPUT_CODE>"]` — first item is input, second is output.
  - Codes from §8 (`WB`, `DB`, `TB`, `FL`, `LS`). Position is **fixed**: input chip on the node's bottom-**left**, output chip on the bottom-**right**.
- `nodes[i].color` — optional **per-node color override**. Any valid `"#hex"` string is accepted; the §4 palette is recommended for cross-diagram consistency but not required. Every node can carry its own color independently of others.

---

## 2. Layout formulas — deterministic geometry

```
label_col_w      = 140
step_slot_w      = 112
right_pad        = 28
n_steps          = len(steps)
n_lanes          = len(lanes)

# Canvas
viewBox_w        = label_col_w + n_steps * step_slot_w + right_pad   # 5 steps → 728
header_h         = 36
lane_h           = 80
has_color_row    = any(node.color or step.color or lane.color in inputs)
legend_h         = 100 if has_color_row else 80                      # 4 rows when colors are present
viewBox_h        = header_h + n_lanes * lane_h + legend_h            # 4 lanes, no colors → 436; with colors → 456

# Header strip (top)
header_y         = 0                                                  # ends at header_h = 36
step_chip_y      = 6                                                  # 16-px chip at y=6..22
step_label_y     = 29                                                 # text line below chip

# Lane positions
lane_y_top(k)    = header_h + k * lane_h                              # 36, 116, 196, 276
lane_y_mid(k)    = lane_y_top(k) + lane_h/2                           # 76, 156, 236, 316
lane_label_x     = label_col_w / 2                                    # 70

# Step / node center x
step_cx(j)       = label_col_w + j * step_slot_w + step_slot_w/2      # 196, 308, 420, 532, 644

# Nodes
node_w           = 100
node_h           = 64
node_x(j)        = step_cx(j) - node_w/2                              # 146, 258, 370, 482, 594
node_y(k)        = lane_y_top(k) + 8                                  # 44, 124, 204, 284

# Legend strip (bottom)
legend_y_top     = header_h + n_lanes * lane_h                        # 356
legend_row_y     = [legend_y_top + 16, legend_y_top + 37, legend_y_top + 59]
                                                                      # 372, 393, 415
```

### 2.1 Background structure

- Paper fill across full viewBox.
- Alternating lane tints: odd-indexed lanes (0, 2, …) receive `ink @ 0.018` fill.
- Lane dividers: horizontal hairlines at every `lane_y_top(k)` and at `legend_y_top`, stroke `ink @ 0.12` width 0.8.
- Label column right border: vertical hairline at `x = label_col_w`, from `y = header_h` to `y = legend_y_top`.

### 2.2 Step header chip

Per step `j`:

```
chip_x(j)        = step_cx(j) - 16        # 16×16 chip
chip_y           = 6
chip_w           = 32
chip_h           = 16
chip_rx          = 8                       # pill-shaped
number_anchor    = (step_cx(j), 14)
label_anchor     = (step_cx(j), 29)
```

Default fill: `ink @ 0.12`, number text ink, label text muted.
Focal fill: `accent @ 0.20`, number + label text accent.
Per-step `color` override (§4): replaces the fill with `rgba(C, 0.20)` and the text fill with `C`.

### 2.3 Lane labels

Two-line `eyebrow` role label, both lines in the secondary text role, fill muted:
- Line 1 at `(lane_label_x, lane_y_mid(k) - 4)`
- Line 2 at `(lane_label_x, lane_y_mid(k) + 8)`

Per-lane `color` override (§4): replaces the label fill with `C` and the lane tint with `rgba(C, 0.04)` (instead of the default `ink @ 0.018`).

### 2.4 Node content layout (inside the 100×64 rect)

```
role_chip          rect 18×10 at (node_x+4, node_y+4),  rx=3
role_chip_text     centered at (node_x+13, node_y+9), eyebrow role, font-size=10, weight=600
title              centered at (step_cx(j), node_y+23), node-name role, font-size=12
sub                centered at (step_cx(j), node_y+35), sublabel role, font-size=10, muted
tool               centered at (step_cx(j), node_y+47), sublabel role, font-size=10, muted
data chip IN       rect 16×8 at (node_x+4,   node_y+54), rx=3      # payload type entering the node
data chip OUT      rect 16×8 at (node_x+80,  node_y+54), rx=3      # payload type leaving the node
```

Empty cells (no node entry) render **nothing**. No placeholder rect, no role chip, no label — the cell is invisible.

---

## 3. Arrow rules (mandatory)

Four styles, bound to topology. Connectors are drawn **before** all node rects (z-order rule).

| `style` | Stroke | Width | Dash | Marker | When required |
|---|---|---|---|---|---|
| `muted` | `muted` | 1.0 | — | `arr-muted` | Standard data hand-off between steps or within a lane. |
| `trigger` | `muted` | 1.0 | `4,3` | `arr-muted` | Governance trigger — an admin action enables downstream work. Unlabelled. |
| `accent` | `accent` | 1.2 | — | `arr-accent` | Focal cross-role handoff. **Exactly one per diagram**, labeled. |
| `link` | `link` | 1.0 | — | `arr-link` | Published / externally-consumed output. |

**Defs block** (required, three markers):

```svg
<defs>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
    <circle cx="11" cy="11" r="0.8" fill="{ink @ 0.10}"/>
  </pattern>
  <marker id="arr-muted" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="{muted}"/></marker>
  <marker id="arr-accent" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="{accent}"/></marker>
  <marker id="arr-link" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="{link}"/></marker>
</defs>
```

### 3.1 Routing rules (non-negotiable)

- **Single-bend routing:** horizontal-first, then vertical. Exit a node from the **right edge**; enter from the **left** (same-lane horizontal) or **top/bottom** (cross-lane vertical).
- **No diagonals.** Bends use an 8-px Q-bezier corner.
- **Same-step cross-lane (vertical)**: line directly between `(step_cx(j), lane_y_top(k_to)−12)` and `(step_cx(j), lane_y_top(k_to))`. Used for admin → engineers triggers under the same step.
- **Cross-lane cross-step (focal)**: exit right, run horizontal past the source node's right edge to a corridor x just before the target's step, then drop vertically.
- **Labels:** only the `accent` arrow gets a label. Use a paper-filled rect mask (opaque) 6 px behind the text. Other arrows are unlabelled.
- **Z-order:** all arrows emitted before any node rect (the rect fills mask the line ends inside the node).

---

## 4. Visual values

Use [visual-style.md](visual-style.md) for colors, fonts, sizes and markers. Optional color inputs select a semantic role for any component, including a focal one; they do not change node roles, relationship kinds or layout formulas.

## 5. Focal rule

Use the semantic role fill/stroke/dark-text triple from visual-style.md on both ordinary and focal nodes. Keep the stated focal count and emphasize those nodes with border weight; role colors do not consume focal slots.

The data-flow diagram is built around **one cross-role handoff** that defines its central claim. Three focal slots, exactly one entry each:

- **One focal step** (`steps[j].focal: true`) — typically the analytical pivot (Analyze, Model, …). Header and legend chips retain their semantic color with focal weight.
- **One focal node** (`nodes[i].focal: true`) — the node that *receives* the focal handoff. Heavier role-colored border + semantic role chip + dark role title.
- **One focal arrow** (`arrows[i].style: "accent"`) — the cross-role handoff into the focal node. Solid accent stroke + labeled with a short payload descriptor (e.g., `anon data`).

If zero or >1 of any focal slot are declared, halt and ask the user.

---

## 7. Reproducibility checklist (taste gate)

Before emitting SVG, verify **every** item:

1. `viewBox = "0 0 {viewBox_w} {viewBox_h}"` derived from `n_steps` and `n_lanes` via §2.
2. Header strip at `y=0..36`; legend strip at `y=legend_y_top..viewBox_h` (`legend_y_top = 36 + n_lanes * 80`).
3. Every node at `(step_cx(j) - 50, lane_y_top(k) + 8)` size `100×64`.
4. Empty cells render nothing — no placeholder rect, no text.
5. Exactly **one** focal step (`steps[j].focal: true`).
6. Exactly **one** focal node (`nodes[i].focal: true`).
7. Exactly **one** focal arrow (`style: accent`). Labeled, with a paper-masked rect behind the label.
8. All other arrows unlabelled.
9. All arrows emitted before any node rect (z-order rule).
10. Single-bend routing only — no diagonals. Q-bezier `r=8` at each bend.
11. Apply semantic role colors consistently, including on non-focal components; role colors do not consume focal slots.
12. Subtitle and tool labels stay muted regardless of any component `color`.

---

## 8. Data-type chips reference (input + output)

Small `16×8 rx=3` badges at the bottom of each node, one for input and one for output. Position is **non-negotiable**:

- **Input chip** at `(node_x+4, node_y+54)` — bottom-**left** of the node. Represents the payload format *entering* the node from upstream.
- **Output chip** at `(node_x+80, node_y+54)` — bottom-**right** of the node. Represents the payload format *leaving* the node toward downstream.

Either chip may be omitted (e.g., a sink node has only an input chip; a source-only node has only an output chip). Reading the diagram becomes a payload-transformation trace: scan a row, read each node's input → output, and you see exactly what shape the data takes at each hand-off.

### Chip codes

| Code | Color | Meaning |
|------|-------|---------|
| `WB` | `#a855f7` (mauve) | Web / Public data |
| `DB` | `#3b82f6` (steel-blue) | Dataset / Raw file |
| `TB` | `#f59e0b` (amber) | Table / Analysis-ready |
| `FL` | `#ec4899` (sienna) | File / Report / Export |
| `LS` | `#22c55e` (forest) | Live stream / Event |

For each chip hue, use the matching light fill, stroke and dark text triple from visual-style.md. Keep the code visible at 10px semibold. The hue encodes payload format according to this table.

Data-type chip colors are a **separate semantic axis** from the per-node color override (§4). The chip colors describe *payload format*; the node color override describes *concern type* (governance, observability, …). Don't conflate them — a node can have both an `out: TB` amber chip and a pink border color simultaneously.

---

## 9. Legend (3- or 4-row strip)

Each row introduced by a category label at `x=144`. The default legend has **3 rows** (`STEPS` / `DATA TYPE` / `FLOW`); when one or more nodes carry a `color` override (§4), add a 4th `CONCERN` row and grow `legend_h` to 100 (so `viewBox_h = header_h + n_lanes·80 + 100`).

- **Row 1 — `STEPS`** at `y = legend_y_top + 16`: repeat the header chips with their labels. Focal step keeps accent fill.
- **Row 2 — `DATA TYPE`** at `y = legend_y_top + 37`: one swatch per chip type actually used in the diagram. **Append a small sub-hint** in the muted `sublabel` role after the chips: `left chip = input · right chip = output`. This makes the position-based input/output convention explicit for first-time readers.
- **Row 3 — `CONCERN`** (only when color overrides are present) at `y = legend_y_top + 58`: one mini-rect per custom color used, with its semantic label (e.g., `Identity · Governance`, `Data Quality · Observability`). The focal accent swatch is also shown here so the reader sees all three colored axes side-by-side.
- **Row 4 — `FLOW`** (last row, position depends on whether `CONCERN` row exists): short line segments with their marker + text label, one per arrow style actually used.

All legend items align on a single horizontal strip per row. Do not stack vertically inside a box.

---

## 10. Complexity budget

| Dimension | Max |
|---|---|
| Lanes (roles) | 4 |
| Steps | 6 |
| Nodes per lane | Nodes = active steps only — empty cells are invisible (no placeholder box) |
| Labelled arrows | 1 (focal accent only) |
| Data-type chips per node | 2 |
| Semantic-colored elements | Not limited by the focal budget; use consistent role colors |

Above 4 lanes or 6 steps: split into two diagrams (e.g., ingestion pipeline / analytics pipeline).

---

## 11. Anti-patterns

- **Placeholder empty cells** — if a role doesn't participate in a step, leave the cell empty (no box, no text).
- **More than one labelled arrow** — only the focal cross-role handoff gets a label.
- **Diagonal arrows** — always horizontal-first, then vertical; single right-angle bend.
- **`title` role for node titles** — node titles use the `node-name` role (technical context). Only the overall SVG heading uses the 16px `title` role.
- **Accent on more than one node, one step, one arrow** — focal = one node + one step + one arrow, max.
- **`node-name` role for role labels** — lane labels always use the `eyebrow` role (they are identifiers, not prose).
- **Discarding a focal element's semantic color.** Keep its role palette and add outline emphasis.
- **Custom-colored arrows** — arrows are topology-driven. Color on a node never spreads to its edges.
- **Unexplained lane tints.** Use quiet, consistent role/category surfaces for lanes; retain clear node boundaries and lane labels.

---
