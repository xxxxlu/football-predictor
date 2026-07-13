---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
lastStep: 14
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/product-brief-football-predictor.md
  - _bmad-output/planning-artifacts/product-brief-football-predictor-distillate.md
  - _bmad-output/planning-artifacts/user-journey-blueprint.md
  - _bmad-output/planning-artifacts/prd-validation-report-2026-07-13-post-edit.md
workflowType: ux-design
status: complete
date: 2026-07-13
completedAt: 2026-07-13T17:30:00+08:00
---

# UX Design Specification — football-predictor

**Author:** xiaolu
**Date:** 2026-07-13

## Executive Summary

### Project Vision

面向 3～10 人朋友群的免费足球判断账本。核心不是模拟博彩，而是用真实赔率、虚拟积分和可审计账本表达判断强度；系统自动同步、封盘、结算与排名，房主不承担运营工作。

### Target Users

- **普通参与者：** 手机优先，从微信群邀请进入，关注快速看盘、提交、观赛和复盘。
- **房主：** 创建房间、分享/重置邀请、查看成员状态；Phase 2 处理补分。
- **两个预置超级管理员：** 处理账号、违规房间、数据异常和安全重试，不直接改账。
- **Phase 2 公开参与者：** 从公开大厅试用，再创建或加入私人房间。

### Key Design Challenges

1. 在 60 秒内解释“确认赔率 × 虚拟投入 × 预计返还”。
2. 同时呈现可用、冻结、净收益和更正债务，避免真钱联想。
3. 让 `ODDS_CHANGED`、`MARKET_CLOSED`、`DATA_UNAVAILABLE` 可理解且可恢复。
4. 在微信内置浏览器、移动网络和 320px 屏幕上保持完整核心流程。

### Design Opportunities

- 用“判断单”而非博彩票据语言，强调预测依据和账本解释。
- 封盘前只显示提交人数，封盘后展开朋友选择，形成观赛仪式感。
- 以时间线账本解释每次冻结、返还、冲正和排名变化。

## Core User Experience

### Defining Experience

北极星流程：打开邀请 → 注册/登录 → 保存恢复码 → 确认规则并加入 → 查看目标比赛 → 选择 1X2 → 输入积分 → 确认最新赔率 → 提交成功。首单目标 ≤60 秒。

### Platform Strategy

Mobile-first H5/PWA；触控优先，桌面增强信息密度。核心写操作必须在线；离线只读，不排队预测。微信内置浏览器是一级支持环境。

### Effortless Interactions

- 邀请上下文跨注册/登录保留，完成后返回目标房间。
- 默认展示即将开赛比赛与 1X2，不要求用户先配置筛选。
- 500/1,000/2,000 快捷投入，仍允许手输。
- 赔率未变化时一次确认；变化时原位更新并要求再次确认。
- 结算、榜单和账本自动更新，无手动刷新要求。

### Critical Success Moments

- 恢复码只展示一次时，用户明确知道保存义务。
- 提交成功时同时看到确认赔率、冻结积分、可用余额和不可变票号。
- 拒绝提交时余额完全不变，并给出下一动作。
- 赛果更正时展示“原结算已冲正 → 新结果已结算”，不隐藏历史。

### Experience Principles

1. **先给结论，再给证据。**
2. **状态不能只靠颜色。**
3. **任何扣分都可追溯。**
4. **封盘与数据不确定时宁可暂停。**
5. **非现金边界持续可见但不打断核心任务。**

## Desired Emotional Response

### Primary Emotional Goals

可信、从容、朋友间有参与感。预测成功后是“我的判断已被可靠记录”，不是刺激性赢钱反馈。

### Emotional Journey

| 阶段 | 目标感受 | 设计手段 |
|---|---|---|
| 打开邀请 | 安全、知道来自谁 | 房间名、房主昵称、成员数、非现金简述 |
| 首次设置 | 轻量但严肃 | 单列步骤、恢复码确认、无手机号 |
| 提交判断 | 掌控、无意外 | 赔率/投入/预计返还同屏、服务端复核提示 |
| 被拒绝 | 可理解、未受损 | 明确原因、余额未变化、恢复动作 |
| 结算复盘 | 公平、可信 | 账本时间线、赔率快照、结算版本 |

### Emotions to Avoid

赌博刺激、余额焦虑、数据是否新鲜的不确定、系统黑箱、房主拥有不透明特权。

## Inspiration & Pattern Decisions

- 借鉴体育比分应用的“今日/未开赛/进行中/已结束”分组，但不复制密集广告结构。
- 借鉴银行流水的可解释时间线，而非博彩站的盈亏闪烁。
- 借鉴协作邀请产品的“邀请上下文跨认证保留”。
- 避免赌场视觉：霓虹、金币、筹码、赔率跳动庆祝、红绿单独表达输赢。

## Design System

### Strategy

采用轻量 token-first 自定义系统，优先原生语义 HTML 与少量无头交互原语。设计语言为 **“Matchday Ledger / 比赛日编辑部”**：温暖纸张底色、深墨蓝、草地绿作为状态而非装饰、珊瑚橙只用于关键提醒。

### Tokens

- Radius：4 / 8 / 12px；不使用全站胶囊卡片。
- Spacing：4px 基础，8/12/16/24/32/48。
- Motion：120ms 状态反馈、220ms 面板切换，`ease-out-quart`；reduced-motion 时关闭位移。
- Elevation：主要靠分隔线和层级，阴影仅用于浮动确认栏。

## Visual Foundation

### Color

| Token | Value | 用途 |
|---|---|---|
| `--paper` | `#F4F0E6` | 页面底色 |
| `--ink` | `#17233B` | 主文本/导航 |
| `--field` | `#176B4D` | 开放、成功、主操作 |
| `--coral` | `#D85B45` | 封盘、错误、风险 |
| `--amber` | `#B7791F` | 赔率变化、同步中 |
| `--line` | `#CBC4B5` | 分隔线 |
| `--muted` | `#665F54` | 次要文本 |

所有正文对比度达到 WCAG 2.2 AA；状态同时使用图标、文字和形状。

### Typography

- Display：`Source Serif 4` 或可用的中文宋体替代，用于比赛标题与赛后战报。
- UI：`Noto Sans SC`，400/500/700。
- 数字：启用 tabular numerals；赔率和积分不使用夸张大号赌博式排版。
- Scale：12 / 14 / 16 / 20 / 28 / 40，使用 `clamp()` 平滑响应。

### Layout

8 列移动栅格、12 列桌面栅格。移动端内容边距 16px；桌面最大内容宽 1280px。赛事信息保持编辑部式水平分隔，避免卡片嵌套。

## Selected Design Direction

**方向：Editorial Matchday Ledger。** 顶部显示房间与当前账户摘要；主区是按时间排序的比赛版面；右侧或移动端抽屉呈现判断单。桌面把比赛、判断单、房间榜组成非对称 7/3/2 栅格；移动端使用底部四项导航。

关键记忆点：每张已提交判断都有一条“账本装订线”，沿线显示提交、封盘、结算、更正节点。

## User Journey Flows

### FLOW-J1 邀请、认证与首单

`邀请落地 → 规则摘要 → 注册/登录 → [注册]恢复码保存确认 → 返回房间 → 确认规则 → 创建10,000账户 → 比赛详情 → 选择 → 投入 → 确认 → 提交结果`

失败分支：昵称冲突原位建议；恢复码未确认不得离开；邀请已失效提供联系房主与返回入口；赔率变化保留投入并要求重确认。

### FLOW-J2 封盘竞态

`提交中 → 服务端复核 → MARKET_CLOSED / ODDS_CHANGED / DATA_UNAVAILABLE / INSUFFICIENT_POINTS / SUCCESS`。所有失败态展示“积分未变化”；仅 SUCCESS 进入账本。

### FLOW-J3 房主管理

`创建房间 → 确认规则 → 分享邀请 → 查看成员提交状态 → 重置邀请 → 二次确认 → 新链接生成`。重置确认明确“旧链接失效、成员不移除”。

### FLOW-J4 超级管理员

`登录/首次改密 → 健康概览 → 异常详情 → 重新认证 → 安全重试/限制房间 → 审计回执`。管理员看不到密码、恢复码和未封盘选择。

### FLOW-J5 公开大厅（Phase 2）

`公共浏览 → 登录 → 公开账户10,000 → 预测 → 全站榜 → 积分耗尽 → 主动申请SYSTEM_GRANT → 补分次数更新`。

## Component Strategy

### Core Components

- **RoomHeader：** 房间名、房主、成员、邀请状态。
- **AccountStrip：** 可用、冻结、已结算变化、`correction_debt`；债务为解释性警示而非负余额。
- **FixtureRow：** 时间、双方、状态、数据时间；整行进入详情。
- **MarketBoard：** 1X2 选项，赔率、更新时间、开放状态。
- **PredictionSlip：** 选择、投入、预计返还、赔率版本、提交状态。
- **SubmissionSeal：** 提交成功凭证，票号、时间、确认赔率。
- **LedgerTimeline：** FREEZE/SETTLE/VOID/REVERSAL/RE-SETTLE/DEBT_OFFSET。
- **MemberSubmissionList：** 封盘前状态，封盘后逐项展开。
- **QuotaHealth：** 95 总量、四池预算、10 次保护线。
- **RuleConsent：** 版本、18+、非现金确认。

### Component States

所有异步组件必须包含 loading、empty、stale、error、permission-denied、offline、success。盘口额外包含 OPEN、PAUSED、CLOSED、DATA_UNAVAILABLE。

## UX Consistency Patterns

### Button Hierarchy

每屏最多一个主按钮。提交判断为 field green；危险操作（重置邀请、关房）为 coral outline，并要求确认；取消和返回使用文本按钮。

### Feedback Patterns

- 成功：内联回执＋状态更新，不用纯 toast。
- 可恢复错误：错误紧邻控件，保留输入。
- 不可恢复错误：解释原因并给安全出口。
- 长任务：显示当前任务状态，不使用无法估时的无限 spinner。

### Form Patterns

标签常驻；错误包含原因与修复；积分输入同步显示上限、可用余额和预计返还；密码/恢复码支持显示切换但禁止日志记录。

### Navigation

移动端：比赛、我的判断、排行榜、房间。桌面：左侧房间切换、主比赛区、右侧上下文面板。管理员角色新增“系统状态”，普通用户不可见。

### Error Matrix

| Code | 文案 | 动作 |
|---|---|---|
| `MARKET_CLOSED` | 比赛已封盘，积分未变化 | 查看已提交/返回赛事 |
| `ODDS_CHANGED` | 赔率已更新，请重新确认 | 使用新赔率确认 |
| `DATA_UNAVAILABLE` | 数据暂不可验证 | 稍后重试/只读查看 |
| `INSUFFICIENT_POINTS` | 当前可用积分不足 | 调整投入 |
| `INVITE_INVALID` | 邀请已失效 | 联系房主/返回 |

## Responsive Design & Accessibility

### Responsive Strategy

- 320–767：单列、底部导航、判断单为底部 sheet；固定确认区不遮挡错误。
- 768–1023：比赛信息与判断单双栏。
- ≥1024：比赛 7 栏、判断单 3 栏、榜单/账户 2 栏。
- 不通过隐藏关键功能适配小屏；表格在移动端转为定义列表。

### Accessibility

WCAG 2.2 AA；正文对比度 ≥4.5:1；大字 ≥3:1；触控目标 ≥44×44px；完整键盘路径；焦点可见；动态结算使用 live region；200% 字体下核心流程可完成；输赢不只靠红绿。

### Testing

实际 iPhone Safari、Android Chrome、微信浏览器、桌面 Chrome/Safari/Edge；320/768/1024/1440 宽度；VoiceOver 与 NVDA；键盘、200% zoom、reduced motion、慢速网络、离线恢复。

## Handoff & Acceptance

- UX 流程引用 FLOW-J1～J5，并映射 PRD Journey/FR。
- Story 验收必须引用组件状态和错误矩阵。
- Phase 1 不设计公开大厅、补分、串关或滚球积分提交。
- 体育数据授权 gate 未关闭前，不设计公开 Logo 或品牌资产依赖。
