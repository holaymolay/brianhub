# BrianHub UI Implementation Order

This turns `docs/ui-improvement-suggestions.md` into an execution sequence.

The goal is not "best looking first." The goal is:

1. remove the highest-risk UX confusion
2. improve the most frequent interactions
3. add polish only after the model is clear

## Priority order

### Phase 1. Make org context impossible to miss

This is the highest priority because it affects ownership, trust, and where data gets created.

Build:

- persistent org context indicator on desktop
- persistent org context indicator on mobile
- explicit `Leave org` / `Back to workspace` action on desktop
- explicit `Leave org` / `Back to workspace` action on mobile
- relabel or hide `Manage` for non-admin members

Rules:

- entering an org must never feel silent
- leaving an org must never require hunting through settings or another menu
- the current context must be visible while creating tasks/projects/lists/notices

Acceptance criteria:

- when an org is active, the user can tell within 1 second that they are in org context
- the exit path is always visible
- a non-admin member does not see a misleading `Manage` affordance

### Phase 2. Fix service worker / token UX

This is the next highest priority because the current flow is security-correct but too easy to mishandle.

Build:

- worker-first detail view
- token inventory table under the worker
- one-time token reveal panel with strong warning
- explicit copy button with success feedback
- leave-page confirmation before dismissing a newly revealed token

Rules:

- worker exists before token
- worker without token is clearly inert
- raw token is shown once only
- existing tokens show metadata only

Acceptance criteria:

- a user can create a worker and token without ambiguity
- a user understands they cannot recover the raw token later
- token rows are easy to scan by label, permissions, expiry, and last-used

### Phase 3. Ship the low-risk task usability wins

These are high-frequency improvements with low architectural risk.

Build:

- overdue / due-today / upcoming due-date color coding
- task completion feedback animation
- optional context-specific mobile FAB labeling in tasks view

Rules:

- due-date color must communicate urgency at a glance
- completion animation should be brief and not flashy
- mobile FAB labeling is secondary and should not block the first two items

Acceptance criteria:

- overdue tasks are visually distinguishable without reading the date carefully
- completing a task gives immediate visible feedback

### Phase 4. Improve the desktop sidebar interaction model

This comes after org context because sidebar polish should not be allowed to obscure the bigger navigation problem.

Build:

- collapsed section item counts
- clearer collapsed-state affordance
- stronger section header differentiation
- accordion transition animation

Open design decision:

- whether sidebar sections should auto-expand to match active context
- or stay entirely user-controlled

Recommended default:

- active section auto-expands
- user can collapse non-active sections
- collapsed headers show counts

Acceptance criteria:

- the sidebar stays informative when compact
- a collapsed section still communicates whether it contains anything useful
- expanding/collapsing feels intentional, not jumpy

### Phase 5. Admin console scaling improvements

This is real, but lower urgency than the first four phases.

Build later:

- better pending-invite visibility
- searchable/scannable user management
- more operationally prominent service worker activity

Acceptance criteria:

- admin can answer `Did the invite go out?`
- admin can find a user quickly
- admin can see whether a worker is alive without digging

## What should not block execution

Do not stop on these:

- typography redesign
- accent color changes
- calendar visual polish
- generalized visual cleanup without product impact

These are not the current bottlenecks.

## Suggested implementation sequence by file area

### Pass 1: org context

Likely files:

- `apps/web/app.js`
- `apps/web/index.html`
- `apps/web/styles.css`
- relevant org/mobile UI tests

### Pass 2: service worker / token UX

Likely files:

- `apps/web/app.js`
- `apps/web/index.html`
- `apps/web/styles.css`
- `apps/web/help/api-docs.js` if the flow changes materially
- admin/help UI tests

### Pass 3: task usability wins

Likely files:

- `apps/web/app.js`
- `apps/web/styles.css`
- mobile/task UI tests

### Pass 4: sidebar interaction model

Likely files:

- `apps/web/app.js`
- `apps/web/index.html`
- `apps/web/styles.css`
- sidebar UI tests

### Pass 5: admin console scale pass

Likely files:

- `apps/web/app.js`
- `apps/web/index.html`
- `apps/web/styles.css`
- admin/help UI tests

## Practical recommendation

If work starts immediately, do it in this order:

1. org context indicator + leave-org affordance
2. `Manage` gate/relabel for non-admins
3. service worker token issuance flow
4. due-date coloring
5. task completion animation
6. sidebar collapsed counts
7. sidebar polish/transition
8. admin console scale improvements

That keeps BrianHub focused on the highest-risk UX failures first.
