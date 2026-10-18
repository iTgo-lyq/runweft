# Visual style

Use a white canvas, light semantic fills, thin outlines, restrained corner radii and CJK-capable system fonts. These visual values apply to every type. The type references determine graph structure, geometry, connection meaning and complexity limits.

## Fonts and sizes

Declare the following stack in a local `<style>` or a `font-family` presentation attribute on the SVG or its text. When a type forbids style elements (such as Polar), use the presentation attribute:

```css
text {
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif;
}
```

Use the installed platform fallback; do not download fonts. The default sizes are:

| Role | SVG size |
|---|---|
| Title | 16px |
| Node/body text | 12px |
| Secondary text and annotations | 10px |

Resolve reference placeholders before emitting SVG: `{title-size}` = `16`, `{node-size}` = `12`, `{secondary-size}` = `10`. The font-role placeholders `{node-name}`, `{sublabel}`, `{eyebrow}`, `{arrow-label}`, `{title}` and `{callout}` all use the stack above. Do not retain serif headings, italic-serif asides or a blanket monospace style. Use legible sizes at the actual display scale; enlarge the whole type ramp for presentation output instead of compressing text to make content fit.

Preserve the supplied label casing and use normal spacing. Semantic notation remains intact: uppercase change codes such as `ADDED` and the italic abstract-class name in UML convey meaning, rather than decorative typography.

## Palette

| Role | Value |
|---|---|
| `paper` | `#ffffff` |
| `paper-2` / container background | `#f8fafc` |
| `ink` / primary text | `#1e293b` |
| `ink-strong` | `#1e293b` |
| `muted` / secondary text / default arrow | `#64748b` |
| `soft` / subdued line | `#94a3b8` |
| `rule` / `rule-solid` | `#94a3b8` |
| `link` / primary flow | `#3b82f6` |
| `accent` | Focal item's semantic/series stroke; default `#3b82f6` when it has no role |
| `accent-tint` | Focal item's matching light fill; default `#dbeafe` |
| `band-1` / `band-2` / `band-3` | `#dbeafe` / `#f8fafc` / `#d1fae5` |
| `band-label` | `#1e293b` |

| Semantic role | Fill | Stroke | Text |
|---|---|---|---|
| Input / primary | `#dbeafe` | `#3b82f6` | `#1e40af` |
| Processing / in progress | `#fef3c7` | `#f59e0b` | `#b45309` |
| Data / output | `#d1fae5` | `#22c55e` | `#166534` |
| AI / analysis | `#f3e8ff` | `#a855f7` | `#6b21a8` |
| Sensitive / warning | `#fce7f3` | `#ec4899` | `#9d174d` |

Use a consistent palette per role. Quantity, status, access and outcomes need text, shape, symbols or line conventions as well as color. Do not invent numerical meaning for decorative fills. A role plus opacity, such as `{ink @ 0.40}`, means the mapped color with that opacity; a text label must remain readable.

### Semantic color and focal emphasis

Assign semantic surfaces before choosing a focus: blue for input/primary, orange for processing/in-progress, green for data/output, purple for AI/analysis, pink for sensitive/warning. Repeat a role's fill/stroke/dark-text triple on every item with that role, including non-focal items. A workflow containing input, processing and output should normally show all three role colors. Use neutral surfaces for context or items with no evidenced role; do not turn known roles gray merely to make the focal item stand out.

Quiet grouping backgrounds, step-number/version chips and shared quantitative anchors such as waterfall totals may remain neutral. These structural surfaces are distinct from the role-colored nodes or series they organize.

**The focal budget counts editorial emphasis, not colored elements or distinct hues.** Keep the type's existing number of focal nodes, paths, series or cells. Emphasize them with the prescribed heavier outline, weight, dots or callout while retaining their semantic hue. Blue is both an ordinary semantic color and the default `accent` token; blue alone never establishes focal status. Repeated warning/status colors are not repeated editorial claims.

For SVG chart validators, put `data-focal="true"` on the bound focal mark (ridge/bump path, bubble/swarm circle, matrix/heatmap cell, Marimekko segment or waterfall bar). Absence or `false` means non-focal. Polar retains its existing `data-polar-focal`. Copy focal inputs from the type's model; do not infer them from a color value. A legend swatch or label is part of the same focal item, not another focus.

Resolve `{role-fill}`, `{role-stroke}` and `{role-text}` to the selected row's triple. `{series-color}` is a consistent categorical hue from the series palette; use its light fill and dark text counterpart for surfaces and labels. A categorical series can share the blue hue without becoming focal. Use only meaningful categories present in the data, and keep their labels or legend keys.

In type snippets, `accent` and `accent-tint` are contextual focal paint slots, not a demand to recolor the focal item blue. Resolve them to that item's role or series. Give differently colored connectors separate marker IDs with matching fills; never reuse one blue marker on an orange or green path.

**Preserve quantitative encodings.** Heatmaps retain one shared hue with a monotone opacity ramp; the hue can be semantic instead of gray. A single-distribution beeswarm retains a uniform non-focal fill so density is read from packing. Waterfalls retain tinted increases and hollow decreases, and dumbbells retain hollow/solid endpoints. Position, area, lengths, ordering, signs, shape conventions and topology never change to accommodate color. Gray grids, axes and quiet grouping backgrounds remain appropriate.

This section owns color choices in all types and snippets. Type rules still own geometry, relationship symbols and focal counts. Choose node/series roles independently of connector roles; a component's color does not automatically recolor its incident edges.

## Surfaces

Use ordinary node corners around `rx=6`, grouping corners `rx=8–12`, and thin strokes around 1–1.5px. Grouping containers use `#f8fafc` or no fill; dashed group borders can use `6,4`. Always paint a white background in standalone SVG. Omit dotted paper, dark variants, glow, shadows and decorative poster chrome. Place group labels in reserved space so they do not overlap children.

Layout gaps, grids, lanes, chart axes and type-specific constraints come from the chosen type. Size nodes for their content and padding; changing fonts requires checking the resulting geometry.

Type formulas describe topology, alignment and baseline layout. Treat label widths, badge sizes and text baselines as content-dependent: use at least 10px secondary text, fit the measured glyph bounds plus padding, and expand affected nodes, lanes, corridors and the canvas together. Never shrink text to fit a badge or truncate a semantic label. Keep chart data coordinates and area/length encodings fixed; move a label to a keyed legend when it cannot fit the quantitative mark.

For filled nodes, use the corresponding semantic fill/stroke/text triple. Neutral context uses a white node or gray grouping surface. Focal emphasis changes the border or weight; text uses the dark semantic text color, not a saturated stroke color. `soft` is a decorative line color, never a small-text color.

Named node treatments retain their meaning: `input` uses Input, `backend` uses Processing, `store` uses Data, `security` uses Sensitive, `external` uses neutral context, and `optional` adds the type's dashed outline to its role surface. `focal` highlights a chosen role; it does not replace that role. Preserve quantitative chart encodings (including opacity ramps, hollow/solid marks and area), with colors resolved through this palette and contrast checked after compositing.

## Arrow appearance

Use notched filled arrows. Define these gray and semantic variants in `<defs>` as needed:

```xml
<marker id="arrow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse">
  <path d="M0,0 L8,4 L0,8 L2,4 z" fill="#64748b"/>
</marker>
<marker id="arrow-accent" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse">
  <path d="M0,0 L8,4 L0,8 L2,4 z" fill="#3b82f6"/>
</marker>
```

Additional arrow colors use the matching semantic stroke: blue for input/primary flow, orange for processing, green for data/output/success, purple for AI/analysis, and red `#ef4444` for a dangerous operation. Neutral relations use gray. Name the relationship in text or a legend and keep its dash/marker convention; a red danger arrow does not change the pink warning node palette. The arrow tip extends 6px beyond the path endpoint: for 5px visual clearance from each box, begin the path 5px outside the source and end it 11px before the target. For reverse or vertical paths, apply the same offsets along the final direction. Recompute port endpoints in geometry examples for this marker; do not let a marker overlap its target.

Connection semantics take precedence over filled-marker appearance: asynchronous messages keep the open marker specified in the sequence reference, and ER/class relations retain their own end symbols. Orthogonal routing, lifelines, guards, return dashes, optional paths and crossing conventions remain those of the selected type. Visual styling never turns an async message into a synchronous call or a forbidden path into an allowed one.

## Series palette

`series-1` through `series-5` map to green `#22c55e`, blue `#3b82f6`, orange `#f59e0b`, pink `#ec4899`, and purple `#a855f7`. Prefer semantic roles where the data supports them; otherwise assign these categorical slots consistently, using only those needed. Preserve the type's series count: if it exceeds five, reuse hues with direct labels and distinct permitted line/mark treatments. Focal series keep their series color and use the type's required stroke weight, dots or shape. Measure contrast against the actual background: ordinary text needs 4.5:1 and graphical boundaries 3:1. When a palette stroke does not pass (especially thin orange or green lines), use that role's dark text color for the boundary or add a contrasting outline. Use primary or semantic dark text when secondary text does not pass on a tinted surface.
