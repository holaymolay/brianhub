# UI Improvement Suggestions

**A note upfront:** This analysis is based on reading source code — not using the app. Observations grounded in code are marked as such. Where real usage context is needed to validate, that's noted. This is a planning document for Codex to act on, not a definitive UX spec.

---

## Architectural UX Problems

These are not decoration issues. They require design decisions before implementation.

---

### 1. Workspace vs. Organization — hidden context switching is the core UX pain

This is the most important problem in the document.

The code reveals three separate places where orgs appear: the sidebar section, a full-page organizations view (`renderOrganizationsPage()`), and the Settings modal (`renderOrganizationsSettings()`). But the deeper problem is not the number of surfaces — it's that entering an org is a silent workspace switch.

When a user opens an org, they're actually switching workspaces under the hood: `openOrganizationSurface()` saves an "anchor" workspace and loads the org's associated workspace. This is invisible to the user. There is no indication that they've left their personal workspace and entered a shared one, except for whatever context clues the content happens to provide.

**What this means in practice:** A user who pops into an org to check something, then navigates the sidebar, is now operating in the org's workspace without knowing it. Tasks they create, projects they open — all of it is happening in the org context. The anchor mechanism exists to bring them back, but if they don't know they left, they won't know to use it.

**Hidden context switching is the highest-risk UX pattern in this app.** Everything else on this list is secondary to solving this.

**Recommendation — persistent context indicator:** Once inside an org surface, the app needs a persistent, always-visible signal that cannot be missed on either desktop or mobile. This is not a toast. It is not a subtle header change. It is a dedicated UI element — a banner, a colored header bar, a named badge in the nav — that says "You are in [Org Name]" and remains visible until the user explicitly returns to their workspace.

**Recommendation — explicit "Leave org" affordance on desktop and mobile:** The "Return to workspace" trigger must be:
- Visible without scrolling or hunting
- Present on mobile (the bottom nav gives no indication of org context)
- Labeled in plain language ("Back to your workspace" or "Leave [Org Name]") — not an icon

The button exists in the code. The question is whether it's discoverable. Treat hidden org switching as a confirmed problem, not a hypothesis — the architecture makes it structurally unavoidable without an explicit indicator.

---

### 2. Org Surface vs. Org Settings — two paths into "org management" with different shapes

The "Open" button enters the org as a workspace. The "Manage" button opens the Settings modal pre-navigated to that org. These are the right two distinct flows, but the naming and entry points don't make the distinction legible.

"Manage" implies administration. "Open" implies entering. That's fine. The problem is: what does a non-admin member see when they click "Manage"? From the code, the Settings modal renders org management controls conditionally based on role. A regular member clicking "Manage" would enter a settings modal with limited options — potentially a dead end or a confusing view.

**Recommendation:** "Manage" should either be hidden from non-admins entirely, or replaced with something like "Settings" that sets expectations correctly. The role check already exists in `isCurrentActorAdmin()` — using it to gate the button label or visibility is a small change with meaningful clarity payoff.

---

### 3. Service Worker / Token UX — the one-time secret problem

The code is explicit: `"BrianHub never stores the raw token in a recoverable form"`. The token is shown once after generation. This is correct security behavior, but the UX around it needs to be unambiguous.

**From the code, the flow is:**
1. Create worker → grant workspaces → generate token
2. Token displayed once in a success state
3. Must copy immediately — cannot be retrieved

**What the code doesn't tell me:** How prominent is the "copy now or lose it" warning? Is the token shown in a copyable input with a copy button, or raw text? Is there a confirmation step before navigating away?

**Recommendations (some verified by code, some need visual confirmation):**

- The token display state should be visually distinct from the rest of the UI — a full-bleed warning panel, not an inline message. The severity of "this token is gone after you leave" warrants interruption-level design.
- There should be a copy-to-clipboard button with explicit confirmation state ("Copied!")
- Navigating away from the token display should prompt a confirmation: "Have you copied your token? You won't be able to see it again."
- Token metadata in the list (status, expiration, last-used) is the right approach and should be easy to scan — a table layout beats a card list here if there are multiple tokens per worker.

---

### 4. Admin Console — three unrelated flows in one surface

The admin console combines: (a) invite management, (b) user controls, and (c) service worker management. These have different audiences and cadences. Invites are occasional. User controls are reactive. Service workers are set-and-forget with occasional maintenance.

The current structure puts all three in a single panel with a sidebar-style layout. This works at small scale but becomes hard to navigate as the org grows — especially if you're looking for a specific pending invite or a specific worker.

**Recommendations:**
- Pending invites need a clear empty state ("No pending invites") and a clear non-empty state that shows count. An admin checking "did my invite go through?" should get that answer at a glance.
- User controls: the dropdown to select a user is a single-select. For any org with more than ~10 users this becomes slow to use. A searchable list or a table with inline edit would scale better.
- Service workers: the activity log is the most operationally important panel here (it tells you whether a worker is alive and behaving). It should be visible without scrolling, not buried below token management.

---

## Usability Problems (code-confirmed)

These are grounded in what the code reveals directly.

---

### 5. Due dates are visually undifferentiated

The code renders all dates in `--muted` color uniformly. Overdue, due-today, and due-next-week look identical. This is a reading problem — urgency requires perception, not calculation. Coloring overdue dates red (`#fa5252`) and today amber (`#ffd43b`) already exist in the color system and would cost one targeted CSS rule.

---

### 6. Task completion has no feedback animation

Checking a task triggers a state change but no visual feedback beyond the checkbox state. The CSS has no keyframe tied to completion. A 200ms checkmark stroke animation + row fade to reduced opacity is the single highest-confidence polish improvement — it's the most-used interaction in the app and currently provides no satisfying response.

---

### 7. Sidebar — the interaction model needs work, not just the header styling

The first version of this doc said "headers look like items." Codex correctly pushed back on that: the real problem is that the accordion behavior and information density still don't have the right interaction model.

What the code shows: six collapsible sections (Tasks, Projects, Orgs, Workflows, Shopping, Notices) at a single level of depth. The accordion state is persistent but the expand/collapse behavior has no animation and no clear signal about what's inside a collapsed section. If Projects is collapsed, there's no count badge or preview to tell you whether it's worth opening.

**Recommendation:** Each section header should show a count of items when collapsed (e.g., "Projects (4)"). This makes the sidebar informative at a glance even when compact. The interaction model question — whether sections should auto-expand based on active context, or stay in user-set state — is a design decision that needs to be made before implementing.

The header styling fix (letter-spacing, weight) is still worth doing but it is polish, not the core problem.

---

### 8. Mobile create flow is two steps when one would do

On mobile, the "+" FAB opens a create sheet that shows action options (Task, Notice, Workflow, Shopping list). If the user is already in the Tasks view, this is an extra tap — they almost certainly want to create a task. The code already handles this: `handleMobileQuickAdd()` checks `getActiveView() === 'tasks'` and goes directly to the task form. The UX implication is that the FAB behavior is context-sensitive, but users may not know that. If it sometimes skips the menu and sometimes doesn't, that inconsistency could be confusing.

**Recommendation:** Make the context-sensitive shortcut explicit. When in the tasks view, the FAB label or icon could indicate "Add task" rather than a generic "+". The behavior is already there — the affordance isn't.

---

### 9. Accordion transitions are instant (polish)

The sidebar accordion open/close has no animation. A `grid-template-rows: 0fr → 1fr` CSS transition would make collapse/expand feel physically grounded. This is low-effort polish — not a priority over the interaction model work in item 7, but worth doing alongside it.

---

## What I still can't assess without using the app

- **Calendar view usability at event density** — the CSS structure is there but render quality depends on real data
- **Whether the org surface "return to workspace" affordance is findable** — it exists in the code but placement/prominence is unknown
- **Mobile task scrolling in practice** — the gesture handling looks correct architecturally but real-device behavior may differ
- **Empty states** — they exist in the code but their quality varies and cannot be assessed from CSS
- **How disorienting the workspace-switch-on-org-open actually is** — this is the biggest unknown. It could be fine in practice or a frequent source of confusion. Usage data would answer this.

---

## What Codex should treat as decided vs. open

| Item | Status |
|---|---|
| Persistent org context indicator (desktop + mobile) | Product decision made — implement. Shape/placement is the only open question. |
| Explicit "leave org" affordance on desktop + mobile | Product decision made — implement. Must be visible without hunting on both platforms. |
| "Manage" button gate / relabel for non-admins | Decided — implement |
| Token display one-time warning (interruption-level) | **Design decision required** — needs a visual treatment, not just copy |
| Due date color coding | Decided — implement |
| Task completion animation | Decided — implement |
| Sidebar section item counts when collapsed | Decided — implement |
| Sidebar section header styling (letter-spacing, weight) | Decided — implement (polish, do alongside above) |
| Accordion open/close transition | Decided — implement (polish) |
| Mobile FAB context labeling | Lower priority — implement after org/workspace issues |
| Admin console user list scalability | Defer — validate with real usage first |
| Typography / accent color changes | Not a problem — do not change |
