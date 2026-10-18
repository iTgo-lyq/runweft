# Annotation Callout (secondary aside)

Use for editorial asides — the "annotation pointer" that marks a detail without competing with the primary diagram grammar. Think marginalia: *"structure IS the index"*, *"no imports, no configuration"*.

## Grammar

```svg
<!-- 1. secondary text: the `callout` role from visual-style.md -->
<text x="904" y="36" fill="{ink}" font-size="{node-size}"
      font-family="'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif" text-anchor="end">no imports, no configuration</text>
<!-- 2. Dashed Bézier leader -->
<path d="M 820 44 Q 700 84 520 216" fill="none"
      stroke="{ink @ 0.40}" stroke-width="1" stroke-dasharray="4,3"/>
<!-- 3. Landing dot -->
<circle cx="520" cy="216" r="2" fill="{ink}"/>
```

## Rules
- Dashed path (`stroke-dasharray="4,3"`) distinguishes the callout leader from primary arrows (which are solid).
- Place callouts in margins (top-right, bottom-left). Never inside the active diagram area.
- Max 2 callouts per diagram. More becomes commentary, not signal.

## Colors

| Intent | Text | Leader |
|---|---|---|
| Neutral aside | `ink` | `ink @ 0.40` |
| Focal / accent | `accent` | `accent @ 0.50` |
| Tertiary (muted) | `muted` | `ink @ 0.30` |

## Anti-patterns
- Solid arrow leader (reads as a flow arrow).
- Callouts crossing primary arrows / lifelines — offset to a clear margin.
- Using a callout to label something the diagram should label directly — put the label on the element.
