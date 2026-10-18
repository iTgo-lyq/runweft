# Core SVG primitives

Routed from SKILL.md §6. SKILL.md keeps the six connector rules as one line each, the arrow roles, and a one-line node box summary. This file holds the markup and the long form of every rule. The SVG template provides a white background and one default filled marker. Add required marker variants from visual-style.md. Load this file for primitive markup and connector edge cases.

Type-specialized primitives (lifeline, activation bar, region) live in the relevant type reference linked in SKILL.md §3.

Snippets here and in every type reference name colors and fonts by role, never by value: `{ink}`, `{muted}`, `{paper}`, `{accent}`, `{link}`, `{soft}` for colors, `{ink @ 0.10}` for a role at an opacity, and `{title}`, `{node-name}`, `{sublabel}`, `{eyebrow}`, `{arrow-label}`, `{callout}` for font families. Resolve each against the visual palette in [`visual-style.md`](visual-style.md) before emitting: `{ink @ 0.10}` becomes the `ink` color as `rgba(r,g,b,0.10)`, and `{sublabel}` becomes that role's full family stack. Uppercase geometry names such as `X` are computed per node. Resolve `FILL`, `STROKE` and `TEXT` to its semantic fill, contrast-checked outline and dark text color.

## Visual primitives

Use the white background and marker definitions in [visual-style.md](visual-style.md).

## Mandatory connector rules

These six rules are **non-negotiable**. Run the pre-output checklist (SKILL.md §9) to verify before producing any diagram.

1. **Rounded right-angle (orthogonal) connectors are mandatory.** Never use diagonal `<line>` or straight slanted paths between nodes that don't share an x or y axis. Every bend must be a quarter-arc with `r=8` (or `r=6` minimum for tight layouts). See `references/type-architecture.md` for the elbow-path formula. Reserve plain straight `<line>` only for connections whose endpoints share the same x or y coordinate. Diagonal connectors are an automatic fail. A connector also leaves and enters each box perpendicular to the edge it touches, at a port on the straight part of that edge at least 8px from a corner. A horizontal segment that starts on a top or bottom edge, or a vertical one that starts on a side edge, runs along the border behind the node fill and reads as an arrow coming out of the corner. From the skill directory, `python3 <skill-dir>/scripts/verify-geometry.py <file>` reports diagonal connectors, border-riding segments, and corner ports.

2. **Label-to-connector margin: 6–10px gap, always.** A label must never sit *on* its arrow — the connector must remain visible. Place the label centered above (or beside, for vertical segments) the line with a **minimum 6px gap** between the bottom of the label's mask rect and the connector stroke. The opaque mask rect prevents the arrow from bleeding through, but the *visible* gap between mask edge and line preserves the reader's ability to trace the connection. If the label is large enough that 6px feels cramped, push it to 8–10px. Never let the mask rect touch or overlap the stroke.

3. **No overlapping connectors.** Two connectors must never share the same stroke path, run parallel on top of each other, or be drawn on top of each other for any segment. When two orthogonal arrows must cross at a single point, apply the **bridge / hop** primitive (see `references/type-architecture.md` § Crossing arrows). When two arrows naturally want to overlap, offset their routing by ≥12px so each line is independently traceable. If you find yourself stacking connectors, redesign the layout — it means two nodes are too close, or the diagram is over budget (split into overview + detail).

4. **Shared edge → fan the attach points.** When two or more connectors enter or exit the *same edge* of a box, each must have its own distinct attach point along that edge — **no two connectors may share a single point on a box**. Spread the attach points evenly along the edge with **≥12px** between adjacent points (8px minimum for very small boxes). Routing rules:
   - For N connectors on an edge of length L, attach point `k` (1..N) sits at offset `L * k / (N + 1)` from the edge's leading corner.
   - When the connectors fan out to destinations on different sides, route each one orthogonally from its own attach point — no merging strokes near the box.
   - When two parallel connectors run in the same direction, keep them ≥12px apart along their entire length, not just at the attach point. Each arrow must remain independently traceable end-to-end.

   No connector may hide another. If you can't tell two arrows apart at a glance, the layout has failed.

5. **A connector must not pass behind a box that isn't its source or destination — except when the box is geometrically unavoidable on a direct orthogonal path.** Reroute around intervening boxes by default. The only legitimate exception is when a cross-cutting node (e.g., a footer service, a horizontal layer bar) physically sits between the connector's source and destination on the only straight path between them. In that exception:
   - The stroke must be **dashed** (e.g., `stroke-dasharray="4,3"`) to signal "transit, not interaction" — it tells the reader the intervening box is not an endpoint.
   - The label sits at the **visible end** of the connector (typically near the source) so it doesn't fall behind the intervening box.
   - No marker (arrowhead) may land on the intervening box's edge — the marker resolves at the true destination only.

   When in doubt, reroute. The exception exists for the narrow case where rerouting is geometrically impossible, not as a shortcut to avoid layout work.

6. **A label mask must not overlap a node drawn after it.** Compare their bounds after supported group and element `translate()` offsets, in the shared canvas rather than separate panel-local coordinates. Rule 2 keeps the label off its own connector; this one keeps it off the boxes. Because nodes are painted after labels, a mask that lands partly inside a node is covered by the node fill and the text renders as a fragment sitting on the node border. Place the label on a segment of the connector that runs through open canvas — for a connector leaving a node's right edge, that means clearing the node's `x + width` before the mask starts. A mask fully *inside* a node is a badge chip and is fine; a mask overlapping a zone container is fine too, since zones are painted first. From the skill directory, verify with `python3 <skill-dir>/scripts/verify-geometry.py <file>`.

## Node box — full pattern

```svg
<!-- 1. Opaque paper mask — prevents arrows bleeding through transparent fills -->
<rect x="X" y="Y" width="W" height="H" rx="6" fill="{paper}"/>
<!-- 2. Styled box -->
<rect x="X" y="Y" width="W" height="H" rx="6" fill="FILL" stroke="STROKE" stroke-width="1"/>
<!-- 3. Rectangular type tag (rx=2, NOT a pill) -->
<rect x="X+8" y="Y+6" width="28" height="12" rx="2" fill="transparent" stroke="STROKE@0.40" stroke-width="0.8"/>
<text x="X+22" y="Y+15" fill="TEXT" font-size="{secondary-size}" font-family="'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif"
      text-anchor="middle">API</text>
<!-- 4. Node name (node-name role, sans: human-readable) -->
<text x="CX" y="CY+2" fill="{ink}" font-size="{node-size}" font-weight="600"
      font-family="'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif" text-anchor="middle">Node Name</text>
<!-- 5. Technical sublabel (sublabel role) -->
<text x="CX" y="CY+18" fill="{muted}" font-size="{secondary-size}"
      font-family="'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif" text-anchor="middle">tech:port</text>
```

## Arrow labels — always mask, always with margin

Every arrow label needs an opaque rect behind it. Without one it bleeds through the line. **And the label must sit with a visible gap above the connector — never on top of it.**

```svg
<!-- Mask sits 14px above the arrow (8px text height + 6px gap). Stroke is at ARROW_Y. -->
<rect x="MID_X-18" y="ARROW_Y-20" width="36" height="12" rx="2" fill="{paper}"/>
<text x="MID_X" y="ARROW_Y-11" fill="{muted}" font-size="{secondary-size}"
      font-family="'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif" text-anchor="middle">WRITE</text>
```

Rules:

- Short labels centered on the segment midpoint; size the mask for the actual glyphs.
- **Mandatory 6–10px gap** between the bottom of the mask rect and the arrow stroke. The connector must remain visible — a label that hides its own arrow is a hard fail.
- Never `writing-mode` vertical.
- For vertical segments, place the label to the side (not on the line) with the same 6–10px horizontal gap.

**Font substitution.** Estimate full-width CJK glyphs at about 1em, then check actual text bounds in the renderer. System font fallback affects width. Measure each label and keep padding; the geometry verifier checks masks against nodes but cannot prove that text fits.

## Legend — horizontal strip at the bottom

**Never put the legend inside the diagram area.** Place as a horizontal strip after all nodes, with a hairline separator:

```svg
<line x1="30" y1="LEGEND_Y-8" x2="VIEWBOX_W-30" y2="LEGEND_Y-8"
      stroke="{ink @ 0.10}" stroke-width="0.8"/>
<text x="30" y="LEGEND_Y+8" fill="{muted}" font-size="{secondary-size}" font-family="'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif">LEGEND</text>
<!-- Items — horizontal row, ~160px apart -->
```

Expand SVG `viewBox` height by ~60px.

## Accessible SVG contract

SKILL.md §12 lists these six points one line each; this is the long form.

Every diagram is an accessible figure by default:

1. Its `<svg>` carries `role="img"` and `aria-labelledby` naming the diagram's `<title>` and `<desc>`.
2. `<title>` is the first child of `<svg>`, before `<defs>`. Assistive technology may ignore a title placed later.
3. The IDs are prefixed per diagram and variant: `<slug>-title` / `<slug>-desc`, where the slug matches the file (`loop`, `loop-detail`, `loop-overview`). Bare `title` / `desc` IDs are banned — two inline diagrams would otherwise share one ID, and the second could be announced with the first's name. Each naming ID must also be unique across the whole document, including non-SVG elements; the packaged `scripts/check_svg.py` rejects these collisions.
4. `<title>` is the short name of the subject — and about 60 characters or fewer.
5. `<desc>` is one sentence stating what the diagram shows in terms a reader needs without the image. Describe the content, not the geometry: “Org chart showing a command center routing work to specialist agents and escalation owners,” not “A box at the top with five boxes below it.” A shape-by-shape narration is worse than no useful description.
6. Decorative-only SVG carries `aria-hidden="true"` instead.
