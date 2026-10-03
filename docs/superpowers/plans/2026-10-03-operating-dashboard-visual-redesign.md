# Operating Dashboard Visual Redesign Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with verification checkpoints.

**Goal:** 将经营驾驶舱视觉升级为“雾白玻璃·东方科技”，保持既有数据、导航与事件交互不变。

**Architecture:** 通过全局设计 token、驾驶舱页面容器、现有驾驶舱子组件的局部 class 调整完成重塑；不改 API、状态编排或业务数据结构。用 CSS 动画和媒体查询提供分段进入、hover 与移动端布局。

**Tech Stack:** React + TypeScript + Tailwind CSS v4 + Vite。

---

### Task 1: Establish visual tokens and motion primitives

**Files:**
- Modify: `web/src/index.css`

- [ ] Replace dark-first dashboard tokens with the confirmed warm mist palette while preserving legacy dark tokens needed by chat/admin.
- [ ] Add reusable surface, focus, stagger, and reduced-motion CSS utilities scoped to dashboard classes.
- [ ] Verify TypeScript/build remains unchanged with `npm run build` from `web`.

### Task 2: Recompose dashboard shell and responsive regions

**Files:**
- Modify: `web/src/components/insights/OperatingDashboardPage.tsx`
- Modify: `web/src/components/insights/TodayAttentionHeader.tsx`

- [ ] Add dashboard root atmosphere, semantic top bar, and stagger classes without changing props or API calls.
- [ ] Make content grid adapt at tablet/mobile widths; preserve event and health panel ordering.
- [ ] Verify existing empty/error/loading branches still render.

### Task 3: Polish event and health surfaces

**Files:**
- Modify: `web/src/components/insights/BusinessEventList.tsx`
- Modify: `web/src/components/insights/BusinessEventCard.tsx`
- Modify: `web/src/components/insights/HealthPanel.tsx`

- [ ] Apply glass surfaces, hierarchy, hover/focus feedback, and compact mobile spacing.
- [ ] Preserve event open callbacks and health formula popover behavior.
- [ ] Run `npm run build` and targeted existing tests.

### Task 4: Refine navigation and verify visual quality

**Files:**
- Modify: `web/src/components/Sidebar.tsx`

- [ ] Restyle dashboard navigation and mobile affordance without changing session CRUD handlers.
- [ ] Run the Impeccable detector on changed UI files, fix actionable findings, and run browser checks at desktop/mobile widths.
- [ ] Run final build/tests and inspect git diff for scope discipline.

