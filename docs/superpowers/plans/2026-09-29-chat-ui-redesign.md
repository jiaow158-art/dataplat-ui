# 对话页经营大脑风格重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有 API、SSE 和业务行为的前提下，将 React 对话页改造成浅色企业经营大脑风格，并让回答以业务结论优先、技术详情默认折叠。

**Architecture:** 保留现有 `api.ts`、`useTaskStream`、`Turn` 状态机和所有请求调用；新增纯展示组件与一个 Markdown 展示适配层。历史回答和流式回答共用同一套 AnswerCard，SQL 记录继续由流式 hook 提供，但移动到 TechnicalDetails 折叠面板。

**Tech Stack:** React 19、TypeScript、Tailwind CSS v4、现有 react-markdown/rehype-sanitize、Vite。

---

### Task 1: 建立浅色经营大脑 design tokens

**Files:**
- Modify: `web/src/index.css`
- Test: `web` build/lint commands

- [ ] **Step 1: Replace dark tokens with light business-dashboard tokens**

保留 token 名称，替换值以避免改动所有组件 API：`base #f4f8fc`、`panel #ffffff`、`card #ffffff`、`lift #eef5ff`、`line #dce7f3`、`line-strong #bfd0e4`、`ink #172b4d`、`ink-2 #5f7188`、`ink-3 #8b9aae`、`accent #1769e0`、`accent-2 #4285f4`、`accent-soft #eaf3ff`，并保留 good/warn/bad 为可读的浅色主题值。

- [ ] **Step 2: Add shared surface utilities**

增加 `.dashboard-shell`、`.answer-card`、`.metric-tile`、`.technical-details`、`.focus-ring` 等 CSS，统一圆角、阴影、边框、焦点环和移动端阴影；不修改 Markdown 白名单或内容逻辑。

- [ ] **Step 3: Run verification**

Run: `npm run build && npm run lint` from `D:\dataplat-ui\web`
Expected: typecheck/build/lint pass；视觉变化仅限 token/utilities。

- [ ] **Step 4: Commit**

`git add web/src/index.css && git commit -m "style: establish light business dashboard tokens"`

### Task 2: Create reusable conclusion-first answer components

**Files:**
- Create: `web/src/components/answer/AnswerCard.tsx`
- Create: `web/src/components/answer/TechnicalDetails.tsx`
- Create: `web/src/components/answer/AnswerMeta.tsx`
- Test: `web/src/components/answer/AnswerCard.test.tsx` (if test runner exists; otherwise type-level/build verification)

- [ ] **Step 1: Define presentation-only props**

`AnswerCard` accepts `{ answer: string; status?: "success" | "attention" | "empty"; technical?: ReactNode; report?: ReactNode; feedback?: ReactNode }`; it must not call APIs or parse SQL.

- [ ] **Step 2: Render the business hierarchy**

Render status badge, title/summary area, Markdown body, optional action/evidence slots, report, and feedback. Use safe existing `Markdown` component. Do not invent KPI data from arbitrary prose.

- [ ] **Step 3: Implement TechnicalDetails**

Use native `<details>` with `aria` semantics and default closed state. Props include `sqls`, `elapsedMs`, `status`, and optional `error`; SQL appears only inside the expanded panel, with horizontal scrolling and a copy button implemented with `navigator.clipboard` guarded by a disabled fallback.

- [ ] **Step 4: Add regression tests/build checks**

Verify default render does not expose SQL text outside the details body, and toggling details exposes it. Run `npm run build`.

- [ ] **Step 5: Commit**

`git add web/src/components/answer && git commit -m "feat: add conclusion-first answer cards"`

### Task 3: Recompose history and streaming turns without changing state flow

**Files:**
- Modify: `web/src/components/HistoryTurn.tsx`
- Modify: `web/src/components/RunStream.tsx`
- Preserve: `web/src/hooks/useTaskStream.ts`

- [ ] **Step 1: Wrap history answers with AnswerCard**

Keep the existing `row.answer_md`, `row.report_path`, `row.status`, and feedback props. Failed/no-answer branches become business-readable status cards, while raw status remains available in TechnicalDetails only when present.

- [ ] **Step 2: Move live SQL rows into TechnicalDetails**

Keep `s.sqls` collection and `SqlRecord` unchanged. Replace inline `SqlBar` list with one collapsed `TechnicalDetails` block. Keep `StatusStrip`, `ErrorBar`, `DoneBar`, retry callback, report path, and feedback API behavior intact.

- [ ] **Step 3: Improve error copy without changing error semantics**

Display “暂时无法完成分析” / “数据服务没有响应” based on existing error code when possible; show original code/message in expanded technical details. Retry must call the same `onRetry(question)`.

- [ ] **Step 4: Run build and inspect all four states**

Run: `npm run build && npm run lint`.
Verify queued/running, succeeded, failed, and cancelled paths still render and no SQL is visible before expansion.

- [ ] **Step 5: Commit**

`git add web/src/components/HistoryTurn.tsx web/src/components/RunStream.tsx && git commit -m "feat: render history and live answers as business cards"`

### Task 4: Redesign ChatView shell and composer

**Files:**
- Modify: `web/src/components/ChatView.tsx`
- Inspect/modify only if needed: `web/src/components/Sidebar.tsx`, `web/src/App.tsx`

- [ ] **Step 1: Preserve ChatView state machine and API calls**

Do not alter `apiListMessages`, `apiAsk`, `onFirstAsk`, `onSessionActivity`, autoAsk, retry, scroll pinning, or session loading branches.

- [ ] **Step 2: Apply dashboard shell layout**

Replace dark panel classes with light dashboard surfaces; add top context bar with session title, data freshness placeholder only when an existing field exists, and a compact “AI 经营助手” label. Keep main message list max width and responsive behavior.

- [ ] **Step 3: Improve empty/loading/error surfaces**

Use a welcome card with three static example prompts that call the same `ask` handler. Keep load error text and retry semantics unchanged.

- [ ] **Step 4: Redesign Composer**

Keep textarea Enter/Shift+Enter/IME behavior and disabled semantics. Add shortcut chips that populate/send through `onSend`, plus a visually prominent blue send button and helper text. No new network behavior.

- [ ] **Step 5: Verify responsive layout**

Run dev server and inspect 1440px and 390px widths; confirm no horizontal overflow and input remains usable.

- [ ] **Step 6: Commit**

`git add web/src/components/ChatView.tsx web/src/components/Sidebar.tsx web/src/App.tsx && git commit -m "feat: redesign chat workspace shell"`

### Task 5: Polish feedback, retry, and action controls with local UI patterns

**Files:**
- Modify: `web/src/components/FeedbackControl.tsx`
- Modify: `web/src/components/RunStream.tsx` error/retry classes if needed

- [ ] **Step 1: Restyle feedback trigger and inline form**

Preserve category values, description max length, `apiSubmitFeedback` call, busy/error/done states. Use a compact outlined “反馈” control and a light form card with clear focus states.

- [ ] **Step 2: Add accessible labels and status text**

Add `aria-expanded`, `aria-live` for submission result, and explicit labels for select/textarea without changing payloads.

- [ ] **Step 3: Verify feedback regression**

Run existing web checks/build and manually verify open → select → submit, cancel, API error, and success paths.

- [ ] **Step 4: Commit**

`git add web/src/components/FeedbackControl.tsx web/src/components/RunStream.tsx && git commit -m "style: polish feedback and retry controls"`

### Task 6: End-to-end visual and contract verification

**Files:**
- Modify only files identified by verification; no server/API files.
- Test: `web` build/lint plus existing smoke checklist.

- [ ] **Step 1: Run static verification**

Run `npm run build` and `npm run lint` in `D:\dataplat-ui\web`; expected pass.

- [ ] **Step 2: Run UI smoke flow**

Follow `D:\dataplat-ui\INSIGHT_UI_SMOKE.md` and the chat flow: login, new question, streaming stages, successful answer, expand technical details, retry failure, feedback submission, report link, session switch, mobile viewport.

- [ ] **Step 3: Verify API immutability**

Run `git diff` and confirm no changes under `server/src`, no changes to `web/src/api.ts`, and no changes to `useTaskStream` event parsing. If any request payload or endpoint changed, revert that edit before proceeding.

- [ ] **Step 4: Capture final screenshots**

Capture desktop 1440px and mobile 390px screenshots showing conclusion card, collapsed technical details, expanded technical details, and failure/retry state.

- [ ] **Step 5: Commit final polish**

`git add web/src && git commit -m "feat: ship conclusion-first chat UI"`

