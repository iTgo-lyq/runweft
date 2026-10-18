# Flowchart

**Best for:** decision logic, algorithms, user-facing branching flows ("Should I…?"), onboarding routing, support-triage trees.

## Layout conventions
- Shape carries control-flow type; semantic color adds role/status information:
  - **Oval** (`rx=20`) — start / end
  - **Rectangle** (`rx=6`) — step / action
  - **Diamond** — decision (≤3 exits)
  - **Small filled ink dot** (`r=4`) — merge point where branches rejoin
- Flow runs top→down. From a diamond, conventional exits: Yes to the right, No below — but label every outgoing arrow regardless.
- Emphasize the happy path or the single most consequential decision. Color all nodes by their semantic roles; repeated role colors are not additional focal decisions.
- If two arrows must cross, use a small arc jump on one so the crossing is readable.

## Anti-patterns
- Using color alone to signal a decision or terminal. Keep the prescribed shape alongside semantic fills.
- Decision diamond with 4+ exits — refactor into nested diamonds.
- Unlabeled decision branches.
