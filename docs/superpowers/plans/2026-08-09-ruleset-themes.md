# Ruleset Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing Vue game UI distinct CoC ghost-green and D&D antique-gold themes while preserving its workflow and fixing the compact start-screen overflow.

**Architecture:** A normalized computed ruleset value drives a `data-ruleset` attribute on the app root. CSS custom properties define semantic surfaces, text, borders, and accents once; existing component selectors consume those tokens without branching or duplicated layouts.

**Tech Stack:** Vue 3 Composition API, scoped-in-file vanilla CSS, Vite, Playwright MCP.

## Global Constraints

- No package dependency changes.
- Preserve HP/SAN/error/success semantic colors.
- Preserve existing component structure and 6/8/12px radius hierarchy.
- Verify at 390, 768, and 1280px.

---

### Task 1: Ruleset theme contract and root state

**Files:**
- Create: `frontend/DESIGN.md`
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: `selectedRuleset: Ref<string>`, `session.ruleset: string`, `screen: Ref<string>`.
- Produces: `activeThemeRuleset: ComputedRef<'coc7e' | 'dnd5e'>` and root `data-ruleset` attribute.

- [ ] Add a computed value that uses `selectedRuleset` on the start screen and normalizes `session.ruleset` on the game screen.
- [ ] Bind `:data-ruleset="activeThemeRuleset"` to `.trpg-app`.
- [ ] Declare the two token sets from `frontend/DESIGN.md` under `.trpg-app[data-ruleset]` selectors.
- [ ] Replace repeated structural colors in App.vue with semantic variables.

### Task 2: Compact start-screen behavior

**Files:**
- Modify: `frontend/src/App.vue`

**Interfaces:**
- Consumes: existing `.start-screen`, `.saved-sessions`, and primary button markup.
- Produces: a 390px layout with no horizontal overflow and a reachable primary CTA.

- [ ] Replace `100vh` with `100dvh` on full-height app/start surfaces.
- [ ] Add a max-height/scroll owner to saved sessions.
- [ ] Add a compact `@media (max-width: 480px)` spacing pass using existing 4px-based steps.

### Task 3: Suggestions endpoint parity

**Files:**
- Modify: `src/api/server.ts`

**Interfaces:**
- Consumes: `GameSession.getSuggestions(): string[]`.
- Produces: `GET /api/sessions/:id/suggestions -> { suggestions: string[] }`.

- [ ] Add the GET route in the existing session route block.
- [ ] Verify a real session returns HTTP 200 and a non-empty list.

### Task 4: Verification

**Files:**
- Verify: `frontend/src/App.vue`, `src/api/server.ts`

- [ ] Run `bun test`; expected `0 fail`.
- [ ] Run `bun run --cwd frontend build`; expected Vite build exit 0.
- [ ] Playwright at 390/768/1280: preview CoC and D&D themes, start a game, inspect console, confirm no overlap/horizontal scroll.
- [ ] Confirm CoC accent is green and D&D accent is antique gold using `getComputedStyle`.
