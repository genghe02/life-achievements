# 人生成就系统 — architecture

A personal "life achievements" app in the style of the Minecraft advancements screen, with
SkyFactory 4-style quest trees (a node unlocks when all its prerequisites are done).

- **One codebase:** a React + TypeScript web app (Vite).
- **Installable PWA:** on a phone it is added to the home screen and runs offline like an app; on a computer it is a normal website.
- **Store packaging later:** Capacitor can wrap the same build for the app stores.
- **Data:** stays on the device (IndexedDB), with JSON backup export and import. Account sync is a later step; the data layer is one document, so a sync backend can be added behind `src/store/persist.ts`.

## Reference implementation

The approved front-end demo is the visual and behavioural spec. Port its look and behaviour one to one unless this document says otherwise.

- Published demo: https://claude.ai/artifact/CXXqTCEZYtVnC8K8uAH4AK
- Demo source (CSS and JS in one file, about 1,450 lines): `/tmp/claude-0/-home-claude/faeccbf8-b527-5958-b01d-cce8a2b1a7c1/scratchpad/app/template.html`
  - It includes every fix from four QA passes: modal height caps, a sticky action row, a phone bottom sheet, sideways docking, toast queue placement, zoom snapping, connector lanes, label chips and so on.
  - When this document and the demo disagree, this document wins.
- Tree-geometry rules the demo content was validated against: `/tmp/claude-0/-home-claude/faeccbf8-b527-5958-b01d-cce8a2b1a7c1/scratchpad/tools/validate_tree.py`

## Stack

| Concern | Choice |
|---|---|
| UI | React 19, function components and hooks |
| State | zustand: `src/store/store.ts` for data, `src/ui/uiStore.ts` for transient UI state |
| Persistence | Dexie (IndexedDB), in `src/store/persist.ts` |
| Build | Vite 8 and vite-plugin-pwa (`registerType: 'prompt'`) |
| Tests | Vitest + jsdom + fake-indexeddb for units; Playwright (desktop 1366x768, phone 390x844) for e2e |
| Styling | Plain global CSS in `src/styles/*.css`, using the demo's class names and tokens. No CSS-in-JS. |
| Fonts | `public/fonts/unifont.woff2` (UI, 16px) and `public/fonts/fusion-pixel-12.woff2` (small text, 12px), both subset to GB2312 + ASCII. Text outside the subset falls back to system fonts. |
| Art | Generated in the browser: 16x16 icons from `src/data/icons.json` (palette + rows), 26x26 frames, 16x16 textures. Ported from the demo's `gridURL`, `ICON`, `FRAME`, `TEX`, `LOCK`, `QMARK`, `XPORB`, `ARROW` and the menu icon. |

## Data model

The data model is `src/domain/types.ts`, which is frozen; ask before changing it. One `LifeData` document holds:

- areas (tabs)
- achievements (nodes, with grid `x`/`y`)
- `done` (date, optional note)
- counter `progress`
- `rewards`, `trades` and `settings`

XP and emeralds are derived. Total XP is the sum of `xp` over done achievements. Emeralds are the sum of `pts` over done achievements minus the sum of trade costs.

## Module map and contracts

| Path | Owns |
|---|---|
| `src/domain/types.ts` | Data types (frozen) |
| `src/domain/rules.ts` | Status and relationships |
| `src/domain/level.ts` | XP curve, ranks, totals, type defaults |
| `src/domain/layout.ts` | Tree geometry, connector routing, conflict checks, auto placement |
| `src/domain/validate.ts` | Backup parsing, validation, normalisation |
| `src/domain/templates.ts` | Starter template (from `src/data/starter.json`), blank data, default rewards |
| `src/domain/dates.ts`, `src/domain/ids.ts` | `today()`, date checks, `newId()` |
| `src/store/contract.ts`, `src/store/inputs.ts` | Store API and form input types (frozen) |
| `src/store/store.ts` | zustand store implementing `AppStore` (exports `useStore`) |
| `src/store/persist.ts` | Dexie DB, debounced save, daily snapshots, `navigator.storage.persist()` |
| `src/art/pixel.ts`, `src/art/sfx.ts` | Pixel art and WebAudio sound effects |
| `src/ui/uiStore.ts` | Selection, modal, arrange mode, centre requests (frozen) |
| `src/ui/hooks/media.ts` | `usePhone()` (≤859px wide), `useSideways()` (≤859 wide and ≤500 tall), `useShortDesktop()` (≥860 wide and ≤780 tall) |
| `src/ui/fx/*` | Toast queue and `<Toasts/>`, burst, floating text, XP orbs |
| `src/ui/actions.ts` | `completeWithFx(id, rect)`, `bumpWithFx(id, delta, rect)`: run the store action, then sounds, effects and toasts |
| `src/ui/App.tsx`, `Hud.tsx`, `AreaTabs.tsx`, `WindowHead.tsx` | App shell |
| `src/ui/tree/*` | Tree viewport, nodes, connectors, tooltip, locked banner, zoom controls, arrange-mode dragging |
| `src/ui/detail/*` | Detail panel (desktop side panel, phone bottom sheet, sideways dock), node detail, area overview |
| `src/ui/modals/*` | Modal shell, trade, node editor, area editor, menu (stats, settings, data), `ModalHost` |
| `src/ui/onboarding/*` | First-launch choice |
| `src/pwa.ts` | Service-worker registration, update prompt, persistent-storage request |

### Domain function contracts (`src/domain`)

```ts
// rules.ts
nodesOfArea(data, areaId): Achievement[]
byId(data): Map<string, Achievement>            // cached per data object (WeakMap)
statusOf(data, id): NodeStatus                   // done | open (every existing parent done) | locked
childrenOf(data, id): Achievement[]
areaRoot(data, areaId): Achievement | undefined  // the node with x === 0
areaLocked(data, areaId): boolean                // root is locked
displayTitle(data, node): string                 // '???' when hidden and locked
undoBlockers(data, id): Achievement[]            // done children that block undo
TYPE_NAME = { task: '任务', goal: '目标', challenge: '挑战' }
TOAST_L1 = { task: '进度已达成！', goal: '目标已达成！', challenge: '挑战已完成！' }

// level.ts
xpAt(level), levelOf(xp): { level, cur, need }, rankOf(level), RANKS
DEF_XP = { task: 40, goal: 120, challenge: 300 }, DEF_PTS = { task: 2, goal: 6, challenge: 15 }
totals(data): { xp, earned, spent, emeralds, done, all }

// layout.ts
GX = 112, PAD = 56
geometry(nodes, gy): {
  nodes: { n, cx, cy }[], width, height,
  bounds,   // pan-clamp box {x0, x1, y0, y1}
  content,  // node-and-label extents for home and fit {x0, x1, y0, y1}
}
connectorSegments(data, areaId, geo): { d: string, state: NodeStatus }[]
  // Each parent's bus (parent to elbow, then vertical) is coloured by the parent: done → gold, otherwise grey.
  // The stem into each child is coloured by the child's status.
  // Buses that meet end to end in the same gap get ±6px lanes.
conflicts(nodes): number    // count of geometry problems (rules below)
findSlot(nodes, parents): { x, y } | null  // a cell after all parents with no new conflicts
canPlace(nodes, id, x, y): boolean         // moving id there keeps the column rule and adds no conflict

// validate.ts
parseBackup(input: unknown): Result<{ data: LifeData }>  // also accepts a bare LifeData; normalises and drops dangling refs

// templates.ts
starterData(now: Date): LifeData   // 7 areas, 97 achievements, nothing done, default rewards
blankData(now: Date): LifeData     // the same 7 areas, each with only its root achievement, no gateways
```

**Geometry rules** (port of `validate_tree.py` and the demo's `conflicts()`):

- One root per area at `x = 0`. Same-area parents sit in a smaller column.
- Within one column gap, the vertical buses of two different parents never overlap. They may touch end to end only at a row where they share a child.
- A horizontal edge into a child never passes through another node's cell.
- A horizontal edge into a child never crosses another parent's bus.

**Rendering:**

- Cell centre is `cx = PAD + x * GX` and `cy = PAD + (y - minY) * gy`.
- `gy` is 84, or 76 on short desktop screens.
- The elbow is at `parent.cx + GX / 2 + lane`.

## Real-app behaviour (differs from the demo)

1. **First launch** shows onboarding with two big choices:
   - **示例模板**: 97 progress items across 7 areas, nothing done. Tell the user to tick what they have already achieved.
   - **空白开始**: each area has only its root.

   A sentence explains that data stays on this device and can be backed up from the menu.
2. **No demo data or demo wording.** Drop 「演示」, the demo progress and the demo trade log. The undo button reads 「撤销完成」.
3. **Done achievements** show 达成日期 (editable date input, not in the future) and 感想 (optional note, up to 200 characters) in the detail panel, saved on blur or change.
4. **Editing:** the detail panel of any achievement has 「编辑」, which opens the node editor prefilled.
   - The editor creates and edits title, completion condition, tip, type, icon, prerequisites (same area; for the root, any achievement of another area as the gateway), counter target and unit, real-life reward, hidden, and advanced XP and emeralds (defaulting from the type).
   - 「删除这个进度」 sits in the editor and needs two steps (second click within 4 s).
   - Deleting is blocked for the root and for nodes others depend on; the message names them in 「」.
   - Changing prerequisites keeps the node's cell if it is still valid, otherwise it re-places the node automatically. If no cell fits, show the demo's error.
5. **Arrange mode** (「整理」 in the window head): nodes can be dragged to another cell, snapping to the grid.
   - Invalid targets show red and snap back. Show a hint bar and a 「完成」 button.
   - Pan still works by dragging empty space.
6. **Areas:**
   - A 「+」 tab at the end of the tab row opens the area editor to create an area: name, subtitle, icon, background.
   - The window head of each area has 「领域设置」 (or an icon button on phones), which opens the same editor to edit it.
   - The editor offers move left and right, and delete (two steps; blocked for the last area). Deleting removes the area's achievements and any gateway references to them.
   - A new area gets one root achievement: title 「新的开始」, type goal, open.
7. **Rewards (交易):**
   - Each reward row can be edited (name, cost, icon) or deleted.
   - New rewards use the existing add form.
   - The trade log shows all entries, newest first. On a long list it scrolls.
8. **Menu (≡):** sections 统计, 设置 (sound and labels), 数据 and 重新开始.
   - **统计:** per-area bars and level/XP/emerald stats.
   - **数据:**
     - 导出备份 downloads `life-achievements-YYYY-MM-DD.json`.
     - 导入备份 takes a file, validates it, shows a summary and needs a confirm step before replacing data.
     - A line shows 「数据只保存在这台设备的浏览器里」 plus the last backup date if known.
   - **重新开始:** pick template or blank, then confirm with two steps.
   - **添加到主屏幕:** on phones, instructions for iOS Safari (分享 → 添加到主屏幕) and for Android or Chrome (an install button when `beforeinstallprompt` fired).
9. **PWA:**
   - Offline after the first load.
   - When a new version is waiting, a toast-like bar says 「有新版本」 with 「更新」.
   - Request `navigator.storage.persist()` after the first completion.
10. **Persistence safety:**
    - Debounced save (300 ms) plus a flush on `visibilitychange` (hidden) and `pagehide`.
    - Keep one snapshot per day for the last 14 days in a separate table.
    - If IndexedDB is unavailable, fall back to localStorage and show a one-line warning in the menu's 数据 section.

## UI copy rules

- **Terms:** Simplified Chinese throughout.
  - Use: 领域 (area), 进度 (achievement), 任务 / 目标 / 挑战 (types), 前置进度, 完成后解锁, 经验, 人生等级, 绿宝石, 交易, 现实奖励.
  - Ranks: 新手 / 学徒 / 老手 / 专家 / 大师.
- **Style:**
  - Short, friendly sentences.
  - Use Chinese punctuation and no spaces inside Chinese text.
  - Names quoted in 「」.
  - Never use 「演示」, 「demo」 or English UI words.
- **Errors:** say what to do next, for example 「先撤销「X」的完成，再撤销这个。」.

## Layout and interaction rules (from the demo, keep)

- **Breakpoints:**
  - Desktop (≥860px): the detail panel is a 340px right column. With nothing selected it shows the area overview.
  - Phone (≤859px): the detail panel is a bottom sheet (max `min(58%, 520px)`, sticky action row). 「概览」 opens the overview in the sheet.
  - Sideways phone (≤500px tall): the sheet docks on the right below the HUD, and the window head moves into the tab row.
  - Short desktop (≤780px tall): compact paddings and `gy` 76.
- **Tree viewport:**
  - Drag to pan, with a 6px threshold before a drag counts. Pinch to zoom. Ctrl/⌘ + wheel zooms; the wheel alone pans.
  - Zoom buttons step through 0.5, 0.75, 1, 1.5 and 2. 「全览」 fits the content and snaps down. 「定位」 resets to the home view.
  - The home view is 1:1. It centres the tree on any axis where it fits; elsewhere it picks the offset that shows the most open nodes.
  - Pan is clamped so the centre of the visible area stays over the tree.
  - Labels are hidden below 0.7 zoom, and below 1 on screens under DPR 1.5.
- **Selection:**
  - A selected node gets the ring, and its label gets a black chip.
  - On a phone, selecting centres the node in the part of the tree not covered by the sheet.
  - Keyboard focus on a node off-screen centres it.
- **Toasts:**
  - Queued: at most 3 visible on desktop (4.2 s each) and 1 on phones (2.6 s).
  - They sit at the top-right of the visible tree area.
  - XP orbs and floating text are drawn above toasts.
- **Other:**
  - Modals have a capped height and scroll inside, trap focus and close on Esc.
  - Hover styles apply only under `@media (hover: hover)`.
  - Touch targets are at least 40px under `(pointer: coarse)`.
  - Respect safe-area insets and `prefers-reduced-motion`.

## Commands

| Command | What it runs |
|---|---|
| `npm run dev` | Dev server. Agents use their own port: `npx vite --port 51xx --strictPort`. |
| `npm run check` | Typecheck, lint and unit tests. Must pass before handing off. |
| `npm run e2e` | Build, preview on port 4173, then Playwright desktop and phone projects. |
| `node tools/shot.mjs <url> <outPrefix> [actions.json]` | Desktop and phone screenshots with console errors. |

## Conventions

- **Strict TypeScript.** No `any` in domain or store code.
- **Purity:** domain functions are pure and synchronous, with unit tests next to them (`*.test.ts`).
- **Components:**
  - Small and typed.
  - Read the store with narrow selectors.
  - Use imperative DOM only where the demo did it for performance or effects (tree transform during pan, particles).
- **Comments:** only where the reason isn't obvious from the code.
- **Dependencies:** no new runtime dependencies without asking.
