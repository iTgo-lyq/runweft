# Kanban Board

**Best for:** a snapshot of work-in-progress by state — what is queued, what is moving, what is stuck, and where the WIP limit is being breached. This is a *state census*, not a flow: a kanban board has **no connectors at all**. That is exactly what separates it from swimlane (lanes plus a flow crossing them, with handoffs as the load-bearing edges) and from process (ordered steps with directional handoffs). If the diagram needs an arrow anywhere, it isn't a kanban board anymore — reach for swimlane or process instead.

## Layout conventions

- **Up to 5 vertical columns of equal width (240px), 32px gutters.** Column background is `ink @ 0.02`; no column border.
- **Header band per column:** column name in the `node-name` role, 12px, weight 600, anchored left. A right-anchored **WIP chip** — a rectangular tag (`rx=2`, **never** a pill) holding `n/limit` in the `eyebrow` role at 10px — or bare `n` on a queue or terminal column, which carries no limit. Every in-process column states one. A hairline `rule` separator sits directly under the header band, full column width.
- **Cards:** the §6 node-box pattern ([primitives-core.md](primitives-core.md#node-box--full-pattern)) at `rx=6`, column width minus 16px padding on each side, 56px tall, 12px vertical gap between cards. Content: title in the `node-name` role, 12px, weight 600, and a `sublabel`-role 10px `muted` sublabel line for `TICKET-ID · owner` (e.g. `AVA-214 · nadia`).
- **Drawing order:** background → column fills → header text + WIP chips → header rules → cards (each: box, then left accent bar if blocked, then title, then sublabel) → legend.

## Card states — the type's semantic vocabulary

Every card renders in exactly one of four states. Document and use all four when the board has enough cards to show them:

| State | Fill | Stroke | Extra |
|---|---|---|---|
| `default` | Processing fill | Processing stroke | — |
| `blocked` | Sensitive/warning fill | Warning stroke dashed `4,4` | 4px warning bar on the card's left edge |
| `waiting / external` | Neutral or role fill | Role/neutral stroke dashed `4,3` | — |
| `done` | Data/output fill | Data/output stroke | — |

These map directly onto the node-treatment table in [visual-style.md](visual-style.md) (`security` → blocked, `optional` → waiting/external, `store` → done) — the board reuses the system's existing semantic fills rather than inventing new ones.

## Over-limit column

When a column's card count `n` exceeds its stated `limit`, use the warning stroke and dark warning text on its WIP chip. Apply warning styling to every over-limit chip and blocked card. These are state encodings; separately choose at most two editorial focal elements and emphasize their outlines.

## Complexity budget

- Max 5 columns, max 4 cards per column, max 12 cards total.
- Max 2 editorial focal elements; repeated state colors do not consume this budget.
- Over budget on a single column → aggregate the backlog into one count card (`+14 more`) rather than listing every item.

## Anti-patterns

- **Drawing arrows between cards.** A board shows state, not flow — if the flow itself needs to be visible, use swimlane or process instead.
- **More than 4 cards in a column.** Aggregate into a count card; don't let a column scroll off the canvas.
- **One card per person.** That's an org chart wearing a kanban skin.
- **In-process columns without WIP limits.** The limit is half the point of the type — a column work flows *through* with no stated limit can't show that it's over budget. The entry queue and the terminal column are the exception: nothing is constrained by holding more done work, so they show a bare count.
- **Giving every blocked card focal weight.** All blocked cards need the warning treatment; only the selected focal cards receive extra emphasis.
- **A "Done" column that grows without bound.** Cap it and note the archive point in the sublabel or a footnote — an unbounded Done column just becomes a second Backlog.
- **Pill-shaped WIP tags.** The chip is a rectangle at `rx=2`, matching the type-tag primitive in the §6 node box ([primitives-core.md](primitives-core.md#node-box--full-pattern)) — pills read as status badges from an unrelated design language.
