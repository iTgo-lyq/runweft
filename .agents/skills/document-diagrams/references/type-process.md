# Process

**Best for:** sequential business processes with multiple actors/divisions where the reader needs to see *who* does *what*, *what data* enters and leaves each step, and *which tools* are used — not just the step order. Covers responsibility audits, data-quality gate reviews, cross-divisional handoff maps, and end-to-end workflow documentation.

Prefer swimlane (simpler) when the data types and tools don't matter. Prefer process when each step's input/output payload and responsible team must be legible at a glance. Prefer **Service blueprint** (`type-service-blueprint.md`) when the claim is onstage vs offstage across stages — a line of visibility, not sequential handoffs.

This type is **parametric** — the inputs schema in §1 drives every coordinate via the formulas in §2. Two generations from the same inputs must produce visually identical SVG. The rule shapes mirror `type-data-flow.md` so color override, IN/OUT chip semantic, and reproducibility checklist read identically across types.

---

## 1. Inputs — the parameter contract

```yaml
lanes:                              # 1..6 horizontal swimlanes (top to bottom)
  - { name: ["RD&E"],                 key: "RDE" }
  - { name: ["IT"],                   key: "IT"  }
  - { name: ["FIELD", "SERVICES"],    key: "FLD" }
  - { name: ["SURVEY", "SERVICES"],   key: "SVY" }
  - { name: ["HOUSEHOLD", "UNIT"],    key: "HHU" }
  - { name: ["COMMS &", "MARKETING"], key: "CMM" }

steps:                              # 1..12 vertical step columns (left to right)
  - { number: "1",  label: "Design"   }
  - { number: "2",  label: "Build"    }
  - { number: "3",  label: "Test", focal: true }       # focal step header chip — accent fill
  - { number: "4",  label: "Train"    }
  # ... up to 12

nodes:                              # explicit per-cell entries; empty cells render nothing
  - { lane: "RDE", step: 0,  title: "Survey design",      sub: "questionnaire · sampling", tool: "Excel · CSPro",
      chips: {in: null,  out: "FL"} }              # first step has no input chip
  - { lane: "IT",  step: 1,  title: "Build app",          sub: "form + validation",        tool: "CSPro · scripts",
      chips: {in: "FL", out: "TB"}, color: "#3b82f6" }    # blue — data quality concern
  - { lane: "RDE", step: 2,  title: "Pilot test",         sub: "field debug",              tool: "tablet · script",
      chips: {in: "TB", out: "TB"}, focal: true }   # focal node — accent border
  - { lane: "FLD", step: 3,  title: "Train enumerators",  sub: "protocols · safety",       tool: "manual",
      chips: {in: "TB", out: "LS"}, color: "#ec4899" }    # pink — governance / training
  # ... etc

arrows:                             # explicit edges; styles bind to topology (see §3)
  - { from: {lane: "RDE", step: 0}, to: {lane: "IT",  step: 1}, style: "normal" }
  - { from: {lane: "IT",  step: 1}, to: {lane: "RDE", step: 2}, style: "focal-in" }     # accent — into focal
  - { from: {lane: "RDE", step: 2}, to: {lane: "FLD", step: 3}, style: "focal-out" }    # accent — out of focal
  - { from: {lane: "RDE", step: 2}, to: {lane: "IT",  step: 1}, style: "trigger" }      # dashed trigger
  # ... etc

```

**Reserved field semantics:**
- `lanes[k].key` — the 3-letter role badge text shown inside every node in that lane.
- `lanes[k].name` — 1 or 2 line lane label; secondary.
- `steps[j].focal: true` — exactly **one** step may declare this. Header chip renders in accent.
- `nodes[i].focal: true` — exactly **one** node may declare this. Renders with accent border (§5).
- `nodes[i].chips` — `{in: "<CODE>", out: "<CODE>"}` object (either side `null` to omit). Codes from §8. **Skip** the input chip on the first step's nodes, **skip** the output chip on the last step's nodes (no upstream / downstream).
- `nodes[i].color` — optional **per-node color override**. Any valid `"#hex"` string; the §4 palette is recommended for cross-diagram consistency.

---

## 2. Layout formulas — deterministic geometry

```
label_col_w      = 140
step_slot_w      = 112                                # 100-px node + 12-px corridor
right_pad        = 28
n_steps          = len(steps)
n_lanes          = len(lanes)

# Canvas
viewBox_w        = label_col_w + n_steps * step_slot_w + right_pad   # 11 steps → 1400
header_h         = 36
lane_h           = 80
has_color_row    = any(node.color or step.color or lane.color in inputs)
legend_h         = 100 if has_color_row else 80       # 4 rows when colors are present
viewBox_h        = header_h + n_lanes * lane_h + legend_h            # 6 lanes, no colors → 596; with → 616

# Header strip (top)
chip_y           = 8
chip_w           = 16                                  # 20 if step.number has 2 digits
chip_h           = 16
chip_rx          = 8                                   # pill

# Lane positions
lane_y_top(k)    = header_h + k * lane_h               # 36, 116, 196, 276, 356, 436
lane_y_mid(k)    = lane_y_top(k) + lane_h/2            # 76, 156, 236, 316, 396, 476
lane_label_x     = label_col_w / 2                     # 70

# Step / node centers
step_cx(j)       = label_col_w + 8 + j * step_slot_w + node_w/2      # 198, 310, 422...
                                                                      # (8-px gutter inside content area)

# Nodes
node_w           = 100
node_h           = 64
node_x(j)        = step_cx(j) - node_w/2
node_y(k)        = lane_y_top(k) + (lane_h - node_h)/2     # 8-px top/bottom margin inside lane

# Legend strip (bottom)
legend_y_top     = header_h + n_lanes * lane_h
legend_row_y     = [legend_y_top + 16, legend_y_top + 37,
                    legend_y_top + 58, legend_y_top + 79]
```

### 2.1 Background structure

- Paper fill across full viewBox.
- Alternating lane tints: odd-indexed lanes (0, 2, …) receive `ink @ 0.018` fill from `x=140` to `viewBox_w`.
- Lane dividers: horizontal hairlines at every `lane_y_top(k)` and at `legend_y_top`; stroke `ink @ 0.12` width 0.8.
- Label column right border: vertical hairline at `x = label_col_w`, stroke `ink @ 0.20` width 1, from `y = header_h` to `y = legend_y_top`.

### 2.2 Step header chip + label

Per step `j`:

```
chip_w(j)        = 20 if len(step.number) >= 2 else 16
chip_x(j)        = step_cx(j) - chip_w(j)/2
number_anchor    = (step_cx(j), chip_y + 11)
label_anchor     = (step_cx(j), 32)              # 8-px gap below chip
```

**Chip** (the numbered pill at the top of each column):
- Default fill: `ink @ 0.12`, number text ink.
- Focal fill: `accent @ 0.20`, number text accent (§5).
- Per-step `color` override (§4): replaces the fill with `rgba(C, 0.20)` and the number fill with `C`.

**Label** (the secondary text below the chip):
- Renders `steps[j].label` (preserving the supplied label), anchored at `label_anchor`.
- Font: the `eyebrow` role's system-font family at 10px, weight 500, ``, `text-anchor="middle"`.
- Default fill: `muted`.
- Focal fill: `accent`.
- Per-step `color` override: fill = `C` (matches the chip number color).
- Keep labels short (≤ 9 chars). Long labels truncate; if you need more, abbreviate.

### 2.3 Lane labels

One or two-line system-font label, normal letter spacing, font-size=10, fill muted. Centered at `(lane_label_x, lane_y_mid(k))`:
- Single-line: anchored at `(lane_label_x, lane_y_mid(k) + 4)`
- Two-line: lines at `(lane_label_x, lane_y_mid(k) - 4)` and `(lane_label_x, lane_y_mid(k) + 4)`

Per-lane `color` override (§4): replaces the label fill with `C` and the lane stripe tint with `rgba(C, 0.04)`.

### 2.4 Node content layout (inside the 100×64 rect)

```
role_chip          rect 14×10 at (node_x+4, node_y+4),  rx=2
role_chip_text     centered at (node_x+11, node_y+12), font-size=10, weight=600
                                                                # text = lanes[k].key (3-letter lane code)
title              centered at (step_cx(j), node_y+26),  font-size=12 sans semibold
in→out             centered at (step_cx(j), node_y+40),  font-size=10 system-font muted
tool               centered at (step_cx(j), node_y+52),  font-size=10 system-font muted
data chip IN       rect 16×8 at (node_x+4,   node_y+54), rx=2      # payload entering
data chip OUT      rect 16×8 at (node_x+80,  node_y+54), rx=2      # payload leaving
```

**Role chip text rule:** the badge inside each node renders `lanes[k].key` where `k` is the node's lane index — **not** the step number (the step number already lives in the column header chip at the top, §2.2). Showing the lane key as the node badge gives each node a self-contained "who" identifier that survives when a single node is excerpted out of context. Mirrors the same rule in `type-data-flow.md` §2.4.

Empty cells (no node entry) render **nothing**. No placeholder rect, no role chip, no label.

**Chip-vs-tool-text collision rule:** chips sit at `node_y + 54..62`; tool text baseline is at `node_y + 52`. If a node has a two-line title (rare), increase node_h to 72 OR omit the chips for that node. Default behaviour: omit chips on collision.

---

## 3. Connector rules (mandatory)

Three styles, bound to topology. Connectors drawn **before** all node rects (z-order rule).

| `style` | Stroke | Width | Dash | Marker | When required |
|---|---|---|---|---|---|
| `normal` | `muted` | 1.0 | — | `arrow` | Standard data hand-off between steps or actors. Unlabelled. |
| `focal-in` / `focal-out` | `accent` | 1.2 | — | `arrow-accent` | Every edge whose endpoint is the focal node (`focal-in`) or origin is the focal node (`focal-out`). |
| `trigger` | `muted` | 1.0 | `4,3` | `arrow-sm` | Orchestration trigger (scheduler → tool, manual override → upstream step). Unlabelled. |

**Defs block** (required, three markers):

```svg
<defs>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
    <circle cx="11" cy="11" r="0.8" fill="{ink @ 0.10}"/>
  </pattern>
  <marker id="arrow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="{muted}"/></marker>
  <marker id="arrow-accent" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="{accent}"/></marker>
  <marker id="arrow-sm" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="{muted}"/></marker>
</defs>
```

Resolve `{ink @ 0.10}`, `{muted}`, and `{accent}` against the visual palette in [`visual-style.md`](visual-style.md) before emitting.

### 3.1 Routing rules (non-negotiable)

**Single-bend right-angle:** exit RIGHT → corridor → enter TOP (↓ destination below) or BOTTOM (↑ destination above).

- Source-side: exit at `(node_x + 100, lane_y_mid(src_lane))` — node's right edge, vertical center.
- Destination-side: enter at `(step_cx(dst_step), node_y(dst_lane))` for downward, or `(step_cx(dst_step), node_y(dst_lane) + 64)` for upward.
- Corner radius: 8-px Q-bezier at the bend.
- Same-lane edges (rare — same lane, adjacent steps): horizontal `<line>` from src right to dst left.
- **No diagonals.** **No left-side entry.** **No exit from the top/bottom of a node.**

```svg
<!-- Downward (destination lane > source lane) -->
<path d="M {rx},{src_cy} H {dst_cx - 8} Q {dst_cx},{src_cy} {dst_cx},{src_cy + 8} V {dst_top}"
      fill="none" stroke="…" stroke-width="…" marker-end="…"/>

<!-- Upward (destination lane < source lane) -->
<path d="M {rx},{src_cy} H {dst_cx - 8} Q {dst_cx},{src_cy} {dst_cx},{src_cy - 8} V {dst_bottom}"
      fill="none" stroke="…" stroke-width="…" marker-end="…"/>

<!-- Same lane (adjacent step) -->
<line x1="{src_right}" y1="{lane_cy}" x2="{dst_left}" y2="{lane_cy}"
      stroke="…" stroke-width="…" marker-end="…"/>
```

- **Z-order:** all `<path>` and `<line>` connectors emitted **before** any node `<rect>`.
- **Markers:** exactly one `marker-end` per path. Never `marker-start`.
- **Labels:** all process arrows are unlabelled by default. The step number + the actor lane carry the semantic; a label on every arrow is noise. Only label an arrow if it represents a non-step concept (re-test loop, escalation) — then use a paper-masked rect behind 10px system-font text.

### 3.2 Crossings

Avoid. The corridor x position (8 px before destination node) is the only routing column — if two arrows would cross there, **swap step assignments** or **split into two diagrams** rather than introducing a bend-around. Crossings hide the underlying control flow.

---

## 4. Visual values

Use [visual-style.md](visual-style.md) for colors, fonts, sizes and markers. Optional color inputs select a semantic role for any component, including a focal one; they do not change node roles, relationship kinds or layout formulas.

## 5. Focal rule

Use the semantic role fill/stroke/dark-text triple from visual-style.md on both ordinary and focal nodes. Keep the stated focal count and emphasize those nodes with border weight; role colors do not consume focal slots.

The process diagram has three focal slots, exactly one entry each:

- **One focal step** (`steps[j].focal: true`) — typically the analytical or decision pivot (Test, Approve, Validate). Header and legend chips retain their semantic color with focal weight.
- **One focal node** (`nodes[i].focal: true`) — the node that *receives* the critical handoff. Heavier role-colored border + semantic role chip + dark role title (title text stays ink so it's still readable; only the border + role chip carry the accent).
- **One focal arrow set** (`style: focal-in` and `focal-out`) — edges into and out of the focal node. Accent solid strokes.

If zero or >1 of any focal slot are declared, halt and ask the user.

---

## 7. Reproducibility checklist (taste gate)

Before emitting SVG, verify **every** item:

1. `viewBox = "0 0 {viewBox_w} {viewBox_h}"` derived via §2.
2. Header strip at `y=0..36`; legend strip at `y=legend_y_top..viewBox_h` (`legend_y_top = 36 + n_lanes * 80`).
3. Every node at `(step_cx(j) - 50, lane_y_top(k) + 8)` size `100×64`.
4. Empty cells render nothing — no placeholder rect, no text.
5. Exactly **one** focal step (`steps[j].focal: true`).
6. Exactly **one** focal node (`nodes[i].focal: true`).
7. Focal-touching arrows use `style: focal-in` / `focal-out` (accent).
8. All other arrows `style: normal` (muted solid) or `style: trigger` (muted dashed). Unlabelled by default.
9. All arrows emitted before any node rect (z-order rule).
10. Single-bend right-angle routing only — exit right, enter top/bottom. No diagonals. Q-bezier `r=8` at each bend.
11. Apply semantic role colors consistently, including on non-focal components; role colors do not consume focal slots.
12. Subtitle and tool labels stay muted regardless of any component `color`. Input chip skipped on first step's nodes, output chip skipped on last step's nodes.

---

## 8. Data-type chips reference (input + output)

Same catalog as `type-data-flow.md` §8.

- **Input chip** at `(node_x+4, node_y+54)` — bottom-**left**. Payload entering the node.
- **Output chip** at `(node_x+80, node_y+54)` — bottom-**right**. Payload leaving the node.
- Either chip may be omitted (first/last step, unknown payload).

### Chip codes

| Code | Color (light) | Meaning |
| ------ | --------------- | --------- |
| `LS` | `#22c55e` green | List / assignment / task |
| `DB` | `#3b82f6` blue | Dataset / tabular records |
| `TB` | `#f59e0b` orange | Table (analysis-ready) |
| `FL` | `#ec4899` pink | File / document / report |
| `WB` | `#a855f7` purple | Web / press / public release |
| N/A | omit chip entirely | Unknown or not applicable |

For each chip hue, use the matching light fill, stroke and dark text triple from visual-style.md. Keep the code visible at 10px semibold. The hue encodes payload format according to this table.

Data-type chip colors are a **separate semantic axis** from the per-node color override (§4). Chip colors describe *payload format*; node color describes *concern type*. A node can have both an `out: TB` orange chip and a pink border simultaneously.

---

## 9. Legend (3- or 4-row strip)

Each row introduced by a category label at `x = label_col_w + 4` (= 144). The default legend has **3 rows** (`STEPS` / `DATA TYPE` / `FLOW`); when one or more nodes carry a `color` override (§4), add a 4th `CONCERN` row and grow `legend_h` to 100.

- **Row 1 — `STEPS`** at `y = legend_y_top + 16`: repeat the header chips with their labels. Focal step keeps accent fill.
- **Row 2 — `DATA TYPE`** at `y = legend_y_top + 37`: one swatch per chip type actually used in the diagram. Append a small sub-hint in muted system-font: `left chip = input · right chip = output`.
- **Row 3 — `CONCERN`** (only when color overrides are present) at `y = legend_y_top + 58`: one mini-rect per custom color used, with its semantic label.
- **Row 4 — `FLOW`** (position depends on whether `CONCERN` row exists): one segment per arrow style actually used, with marker + label.

---

## 10. Complexity budget

| Dimension | Max |
|---|---|
| Lanes (actors) | 6 |
| Steps | 12 |
| Nodes per lane | Nodes = active steps only — empty cells are invisible |
| Labelled arrows | 0 by default (label only for non-step concepts) |
| Data-type chips per node | 2 (input + output) |
| Semantic-colored elements | Not limited by the focal budget; use consistent role colors |

Above 6 lanes or 12 steps: split into two diagrams (overview + detail).

---

## 11. Anti-patterns

- **Placeholder empty cells** — if an actor doesn't participate in a step, leave the cell empty (no box, no text).
- **Diagonal arrows** — every connector must have exactly one right-angle bend. No direct straight lines between nodes in different lanes.
- **Left/right port entry on a vertical-dominant arrow** — always exit right, enter top or bottom.
- **More than one focal step / focal node** — pick the single most critical operation.
- **Unlabelled lanes** — every swimlane must identify its actor.
- **All arrows the same style** — orchestration triggers must be dashed to distinguish them from data-flow connectors.
- **Discarding a focal element's semantic color.** Keep its role palette and add outline emphasis.
- **Custom-colored arrows** — connectors are topology-driven; `color` on a node never spreads to its edges.
- **Unexplained lane tints.** Use quiet, consistent role/category surfaces for lanes; retain clear node boundaries and lane labels.
- **Data-type chips in a double-line-name node** — skip the chips or shorten the name to one line.
- **More than 12 steps without splitting** — use an overview + detail pair.

---

## 12. Worked example — full YAML for an extended process variant

The following input block describes an extended process workflow with custom colors and lanes. Every coordinate in the rendered SVG is derivable from this block via §2 + §3 + §4, demonstrating the parametric layout contract end-to-end.

```yaml
# Quarterly survey — end-to-end workflow (extended variant)
# 6 lanes × 11 steps, 1 focal step + 1 focal node + 3 custom-colored nodes

lanes:
  - { name: ["RD&E"],                 key: "RDE" }
  - { name: ["IT"],                   key: "IT"  }
  - { name: ["FIELD", "SERVICES"],    key: "FLD" }
  - { name: ["SURVEY", "SERVICES"],   key: "SVY" }
  - { name: ["HOUSEHOLD", "UNIT"],    key: "HHU" }
  - { name: ["COMMS &", "MARKETING"], key: "CMM" }

steps:
  - { number: "1",  label: "Design"   }
  - { number: "2",  label: "Assign"   }
  - { number: "3",  label: "Collect",  focal: true }    # focal step header chip
  - { number: "4",  label: "Review"   }
  - { number: "5",  label: "Validate" }
  - { number: "6",  label: "Weight"   }
  - { number: "7",  label: "Clean"    }
  - { number: "8",  label: "Tabulate" }
  - { number: "9",  label: "Approve"  }
  - { number: "10", label: "Publish"  }
  - { number: "11", label: "Upload"   }

nodes:
  - { lane: "RDE", step: 0,  title: "Sample Design",     sub: "Census data → Sample",
      tool: "SAS · Survey Solutions",      chips: {in: null, out: "LS"} }                # first step: no input chip
  - { lane: "IT",  step: 1,  title: "Field Assignment",  sub: "Sample → Field tasks",
      tool: "Survey Solutions",            chips: {in: "LS", out: "LS"} }
  - { lane: "FLD", step: 2,  title: "Data Collection",   sub: "→ 10,464 dwellings",
      tool: "Survey Solutions",            chips: {in: "LS", out: "DB"},  focal: true }   # focal node
  - { lane: "SVY", step: 3,  title: "HQ Review",         sub: "Submissions → Approved",
      tool: "Survey Sol. HQ",              chips: {in: "DB", out: "DB"},  color: "#ec4899" }   # pink · governance
  - { lane: "IT",  step: 4,  title: "Error Checks",      sub: "Approved → Cleaned",
      tool: "SAS · Scripts",               chips: {in: "DB", out: "DB"},  color: "#3b82f6" }   # blue · data quality
  - { lane: "RDE", step: 5,  title: "Weight Calculation", sub: "Cleaned → Weighted",
      tool: "SAS",                         chips: null }                                  # 2-line title — chips skipped
  - { lane: "HHU", step: 6,  title: "2° Cleaning",       sub: "Weighted → Analysis",
      tool: "SAS · R · SPSS",              chips: {in: "DB", out: "TB"} }
  - { lane: "HHU", step: 7,  title: "Tables + Brief",    sub: "Analysis → Tables",
      tool: "Excel · SAS",                 chips: {in: "TB", out: "FL"} }
  - { lane: "CMM", step: 8,  title: "Stats Review",      sub: "Tables → Approved",
      tool: "Internal review",             chips: {in: "FL", out: "FL"} }
  - { lane: "CMM", step: 9,  title: "Public Release",    sub: "Approved → Public",
      tool: "Press conference",            chips: {in: "FL", out: "WB"}, color: "#22c55e" }   # olive-green · data products
  - { lane: "IT",  step: 10, title: "Upload NatStat / SDMX", sub: "Results → Published",
      tool: "Web · SDMX API",              chips: null }                                  # 2-line title — chips skipped

arrows:
  - { from: {lane: "RDE", step: 0}, to: {lane: "IT",  step: 1},  style: "normal"    }
  - { from: {lane: "IT",  step: 1}, to: {lane: "FLD", step: 2},  style: "focal-in"  }     # → focal
  - { from: {lane: "FLD", step: 2}, to: {lane: "SVY", step: 3},  style: "focal-out" }     # ← focal
  - { from: {lane: "SVY", step: 3}, to: {lane: "IT",  step: 4},  style: "normal"    }     # upward
  - { from: {lane: "IT",  step: 4}, to: {lane: "RDE", step: 5},  style: "normal"    }     # upward
  - { from: {lane: "RDE", step: 5}, to: {lane: "HHU", step: 6},  style: "normal"    }     # downward, skips 2 lanes
  - { from: {lane: "HHU", step: 6}, to: {lane: "HHU", step: 7},  style: "normal"    }     # same lane
  - { from: {lane: "HHU", step: 7}, to: {lane: "CMM", step: 8},  style: "normal"    }
  - { from: {lane: "CMM", step: 8}, to: {lane: "CMM", step: 9},  style: "normal"    }     # same lane
  - { from: {lane: "CMM", step: 9}, to: {lane: "IT",  step: 10}, style: "normal"    }     # upward, skips 4 lanes

```

### 12.1 What this YAML proves

Run §2 of this reference with these inputs:

- `n_lanes = 6`, `n_steps = 11`, `has_color_row = true` (3 nodes carry `color`).
- `viewBox_w = 140 + 11 * 112 + 28 = 1400`. ✓
- `legend_h = 100`, `viewBox_h = 36 + 6 * 80 + 100 = 616`. ✓
- Lane y_top = [36, 116, 196, 276, 356, 436]; lane mid = [76, 156, 236, 316, 396, 476]. ✓
- Step cx = [198, 310, 422, 534, 646, 758, 870, 982, 1094, 1208, 1320] (the 8-px content-area gutter shifts every value by 8 from `140 + j*112 + 50`). ✓
- Node 4 (HQ Review): step=3, lane="SVY" (k=3) → x = 534-50 = 484, y = 276+8 = 284. ✓
- Node 5 (Error Checks): step=4, lane="IT" (k=1) → x = 646-50 = 596, y = 116+8 = 124. ✓
- Node 10 (Public Release): step=9, lane="CMM" (k=5) → x = 1208-50 = 1158, y = 436+8 = 444. ✓

A fresh generation from this YAML produces deterministic coordinates directly from the formula without manual tweaking.

### 12.2 Adapting this YAML to a different process

To document a different process, change only the value of these inputs:

- **Lanes**: rename `lanes[k].name` to your team names; update each `nodes[i].lane` to match. Up to 6 lanes.
- **Steps**: rename `steps[j].label`, move `focal: true` to the step that defines the diagram's central claim. Up to 12 steps.
- **Nodes**: write one entry per `(lane, step)` cell that has work. Leave cells empty (no entry) to render nothing.
- **Colors:** assign the shared semantic palette to every evidenced role. Repeated role colors do not consume focal slots.
- **Arrows**: declare every edge explicitly with `style: normal | focal-in | focal-out | trigger`. The routing rule (§3.1) fills in the geometry.

Everything else — viewBox sizing, chip positions, legend layout, visual token selection — is derivable. The YAML is the **source of truth**; the SVG is one of many possible renderings of it (light/full all derive from the same inputs with different style tokens).

---
