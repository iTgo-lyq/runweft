# Layer Stack

**Best for:** OSI model, CSS cascade, context hierarchy, tech stack, abstraction layers, memory hierarchy.

## Layout conventions
- Horizontal bands stacked vertically. Each layer is a full-width rectangle (same x, same width). 4–6 layers total.
- Layer height 56–72px, width typically 800–880px inside a 1000px viewBox.
- Each row contains (left→right):
  1. **Index tag** on the far left (`L3`, `07`, `APPLICATION`) — `eyebrow` role, 10px.
  2. **Layer name** slightly right of center-left — `node-name` role, 12px 600.
  3. **Sublabel / note** on the far right — `sublabel` role, 10px, `muted`.
- Border between layers: 1px hairline `ink @ 0.12` (the `rule` role). Outer silhouette 1px `ink` or `muted`.
- Fills: use semantic role surfaces for the layers; keep neutral fills where a layer has no evidenced role. Preserve stacking order and separators.
- Direction indicator on the LEFT margin (outside the stack): small up/down arrow + `eyebrow`-role label (`abstraction ↑`, `packets ↓`).
- accent on **one** focal layer (stroke + subtle tint fill) — the bottleneck, the pay-rent layer, the one under discussion.

## Anti-patterns
- Layers that aren't actually hierarchical (use swimlane or architecture).
- Skipped numbering (missing L4 between L3 and L5 without explanation).
- Arbitrary per-layer colors without stable role meanings or labels.
- Inconsistent layer heights without reason.
