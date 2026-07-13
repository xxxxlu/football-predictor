---
stepsCompleted: [1, 2, 3, 4]
lastStep: 4
status: complete
completedAt: 2026-07-13
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
---

# football-predictor - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for football-predictor, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR1: 普通用户可以使用用户名和密码注册账户，无需提供手机号或邮箱。
- FR2: 用户可以登录、退出，并在其他设备登录同一账户。
- FR3: 用户注册完成后仅能查看一次恢复码；用户可以使用“用户名 + 有效恢复码 + 新密码”恢复账户，恢复成功后旧恢复码和全部既有会话失效，并仅展示一次新的恢复码。
- FR4: 用户可以设置和修改对房间成员展示的昵称。
- FR5: 用户注册时必须确认年满 18 岁及当前版本的非现金使用规则；规则版本更新后，用户执行下一次受保护写操作前必须重新确认。
- FR6: 系统固定预置两个超级管理员账号，公开注册或产品内操作不能创建第三个超级管理员；超级管理员首次登录必须修改初始密码，凭证重置或账号替换必须通过受控运维流程完成并留痕。
- FR7: 系统必须按角色限制操作：普通用户只能操作自己的账户、预测和所属房间数据；房主额外管理其创建房间的邀请、成员状态及 Phase 2 补分；超级管理员只能执行 FR54～FR58，且受 FR59 限制。
- FR8: 被禁用账户的既有会话必须失效，且不能创建或加入房间、提交预测、查看私人房间数据或执行其他受保护操作；账户恢复后可以重新登录并访问原有账户、房间和账本数据。
- FR9: 已登录普通用户可以创建私人房间并成为房主。
- FR10: 创建房间时，房主必须确认当前版本的房间使用规则。
- FR11: 房主可以生成和重置房间邀请链接；重置后旧链接立即失效，已加入成员、积分账户、预测和账本记录保持不变。
- FR12: 已登录用户确认当前房间规则后可以通过有效邀请链接幂等加入未关闭、未限制的私人房间；重复加入不得重复创建成员关系或发放初始积分。
- FR13: 用户可以加入多个私人房间并在房间之间切换。
- FR14: 用户可以查看房间成员及其房间角色。
- FR15: 房主可以查看哪些成员已经提交预测，但封盘前不能查看其具体选择和投入。
- FR16: 用户可以举报涉嫌用于真钱活动或其他违规用途的房间。
- FR17: 用户可以浏览目标足球赛事、比赛时间和比赛状态。
- FR18: 用户可以查看指定 bookmaker 的赛前胜平负赔率、更新时间和数据状态。
- FR19: 系统可以根据供应商数据更新改期后的开球时间和比赛状态。
- FR20: 用户可以查看滚球比分和滚球赔率；验证阶段这些数据仅供查看。
- FR21: 用户可以区分数据正常、同步中、过期、暂停和不可用状态。
- FR22: 当供应商剩余额度接近受保护 10 次请求、赔率超过 NFR32 新鲜度或数据无法验证时，系统必须停止相应同步并把受影响盘口标记为 `DATA_UNAVAILABLE`，且不得接受新预测。
- FR23: 用户浏览、刷新、切换房间或重复打开比赛只能读取产品缓存，不得直接或同步触发外部供应商请求。
- FR24（Phase 2）: 用户可以查看多 bookmaker 市场共识和明确标识的模型赔率，并能区分 `MARKET` 与 `MODEL` 数据。
- FR25: 用户可以选择一个开放结果并填写不超过 20,000 且不超过可用余额的积分投入。
- FR26: 用户提交前可以查看选择、确认赔率、投入积分和预计返还。
- FR27: 用户可以提交赛前单项预测。
- FR28: 系统只在盘口开放、实际开球前且赔率数据有效时接受赛前预测。
- FR29: 赔率变化时，系统可以要求用户基于最新赔率重新确认。
- FR30: 预测被拒绝时，用户可以看到明确原因和可执行的恢复方式。
- FR31: 被拒绝的预测不会生成预测单或改变积分。
- FR32: 用户重复点击或请求重试不会产生重复预测和重复积分冻结。
- FR33: 用户可以查看自己的预测历史、赔率快照和当前状态。
- FR34: 封盘前，其他成员只能看到提交状态；封盘后可以查看成员的选择和投入。
- FR35（Phase 2）: 用户可以提交亚洲让球、大小球、2～8 项串关及符合数据条件的滚球预测。
- FR36: 用户在每个房间拥有相互独立的积分账户。
- FR37: 用户首次加入每个房间时获得一次 10,000 初始积分。
- FR38: 房间积分持续保存且不进行每周自动重置。
- FR39: 用户可以区分非负的可用积分、非负的冻结积分、已结算变化及因赛果更正产生的待抵扣 `correction_debt`；只有可用积分可以投入预测。
- FR40: 系统接受预测时必须在同一原子操作中扣减可用积分、增加等额冻结积分、创建预测单及其赔率快照并写入冻结流水；任一部分失败时全部不生效。
- FR41: 系统必须按 Point & Settlement Contract 处理赢、输、走盘、确认取消、推迟、中断和未最终确认状态，并仅在预测单最终返还值上执行一次四舍五入。
- FR42: 用户可以查看每笔冻结、结算、退款、补分、冲正、重新结算和债务抵扣流水，以及其关联预测、房间、结算版本和操作时间。
- FR43（Phase 2）: 私人房间成员可以申请补分，房主可以决定补分数量并批准或拒绝。
- FR44（Phase 2）: 公开大厅用户可以申请固定 10,000 分的系统补分，补分次数公开展示。
- FR45（Phase 2）: 补分记录与预测收益分开显示，且不计入预测净收益和收益排名。
- FR46: 用户不能购买、出售、转让、赠送或兑换积分。
- FR47: 系统只能在供应商确认最终赛果或确认取消后自动结算；推迟、中断或状态未最终确认的预测必须保持冻结和待结算。
- FR48: 系统可以安全重试未完成的冻结、结算、取消退款或更正；以“预测单 + 结算版本 + 操作类型”为幂等作用域，重复执行不得新增流水或改变余额。
- FR49: 供应商更正赛果时，系统必须先以新结算版本冲正原结算，再应用新结果并重算排行榜；扣减超过可用积分时，可用积分降至 0，差额进入 `correction_debt`，不得改变其他预测的冻结额。
- FR50: 用户可以查看房间排行榜、余额、净收益和已结算预测。
- FR51: 用户可以从赔率快照和账本记录解释预测结果及排名变化。
- FR52（Phase 2）: 用户可以查看公开排行榜、阶段榜、长期命中率、虚拟收益率和擅长盘口。
- FR53（Phase 2）: 用户可以生成不包含敏感房间数据的赛后战绩分享卡。
- FR54: 超级管理员可以查看用户的启用/禁用状态、房间的正常/限制/关闭状态及相关举报，但不能查看密码、恢复码、完整会话令牌或未封盘预测选择。
- FR55: 超级管理员可以禁用和恢复普通用户账户。
- FR56: 超级管理员可以查看举报并限制、关闭或恢复违规房间。
- FR57: 超级管理员可以查看当日供应商计费请求量、各请求池消耗、剩余额度、最后同步时间、数据新鲜度、待结算任务、失败任务和关联审计记录。
- FR58: 超级管理员重新确认身份后，可以对失败的同步或结算任务触发使用原幂等作用域的安全重试，但不能修改任务输入、赔率快照或结算结果。
- FR59: 超级管理员不能直接覆盖积分余额、删除原始预测或删除账本流水。
- FR60: 系统必须审计账户禁用/恢复、房间限制/关闭/恢复、邀请重置、超级管理员凭证重置或替换、安全重试、规则确认、结算更正、数据来源和供应商条款版本；每条记录包含操作者或系统主体、目标、动作、结果、时间和关联审计标识。
- FR61（Phase 2）: 用户可以进入公开大厅，首次进入时获得 10,000 初始积分，并拥有与私人房间隔离的公开积分账户。
- FR62（Phase 2）: 用户可以从公开大厅创建或加入私人房间。
- FR63（Phase 2）: 用户可以在不同房间中保留独立余额，同时累积个人长期战绩。
- FR64（Phase 3）: 房间可以跨世界杯、俱乐部联赛和其他足球赛事持续存在。
- FR65: 用户可以在受支持的手机和桌面浏览器完成全部核心流程。
- FR66: 用户可以将产品安装为 PWA，但未安装时仍可正常参与。
- FR67: 断网时用户可以查看最近同步的只读内容，但不能提交或排队预测。
- FR68: 页面恢复连接或回到前台时可以同步产品服务端的最新状态。
- FR69: 私人房间、预测、账本和排行榜不会被搜索引擎公开索引。
- FR70: 用户可以申请删除账户；系统可以解除其公开身份，同时保留维持账本一致性所必需的最小记录。
- FR71: 所有页面固定展示简版非现金声明，用户可以查看完整使用规则。
- FR72: 产品不提供充值、提现、支付、资金托管、现金映射、奖品兑换或外部下注入口。

### NonFunctional Requirements

- NFR1: 移动端第 75 百分位达到 `LCP ≤ 2.5s`、`INP ≤ 200ms`、`CLS ≤ 0.1`。
- NFR2: 在 NFR4 负载下，从产品缓存读取赛事、房间和排行榜的服务端响应 `p95 ≤ 800ms`。
- NFR3: 在 NFR4 负载下，预测提交、积分冻结及本地已知的数据不可用拒绝响应均须达到 `p95 ≤ 1s`。
- NFR4: 系统应支持至少 20 个用户在 10 秒内同时提交预测，且重复单、重复冻结均为 0。
- NFR5: 完成结算后，排行榜和用户余额应在 60 秒内对用户可见。
- NFR6: 预测单创建与积分冻结必须同时成功或同时失败。
- NFR7: `MARKET_CLOSED`、`ODDS_CHANGED`、`DATA_UNAVAILABLE` 等拒绝结果造成的积分变化必须为 0。
- NFR8: 已向用户确认成功的预测，在应用进程重启后不得丢失。
- NFR9: 供应商最终赛果确认后，预测最终结算成功率必须达到 100%；失败任务必须保持待处理状态并可安全重试。
- NFR10: 任何任务重复执行不得造成重复冻结、重复结算或重复补分。
- NFR11: 赛果更正不得覆盖原历史，冲正前后的余额差异必须能由账本完整解释。
- NFR12: 账户、预测和账本数据至少每 6 小时自动备份一次，备份保留不少于 7 天，灾难恢复目标 `RTO ≤ 4h`、`RPO ≤ 6h`。
- NFR13: 在目标比赛开球前 2 小时至赛后 30 分钟期间，按 1 分钟探测统计，核心登录、预测和查账功能可用性目标为 99%。
- NFR14: 所有网络传输必须使用 HTTPS，禁止通过明文协议发送凭证、恢复码或会话信息。
- NFR15: 密码不得以明文、可逆密文或通用快速哈希保存；密码存储方案及其参数必须通过 NFR21 的适用控制检查，并保留发布版本对应的安全评审记录。
- NFR16: 密码、恢复码、API Key 和会话令牌不得写入应用日志或发送到浏览器分析工具。
- NFR17: 登录和恢复码验证必须分别按账户与请求来源限流；任一维度在 15 分钟内连续失败 5 次后，后续尝试至少延迟至该窗口结束并记录安全事件；限流窗口到期后自动恢复，不得形成永久账户锁定。
- NFR18: 超级管理员会话空闲 30 分钟后失效；执行 FR55 账户禁用/恢复、FR56 房间限制/关闭/恢复、FR58 任务重试及超级管理员凭证重置或替换前必须重新确认身份，确认结果最多有效 5 分钟。
- NFR19: 普通用户无法访问其他房间的私人预测、账本或成员数据；房主权限只在其拥有的房间内有效。
- NFR20: API-FOOTBALL Key 和数据库管理凭证只能存在于服务端受控环境。
- NFR21: 发布前应满足 OWASP ASVS 5.0 Level 1 的适用基础控制，并且不存在未处理的 Critical 或 High 级漏洞。
- NFR22: 用户账号删除申请应在 7 天内完成公开身份解除；保留的最小账本记录必须匿名化。
- NFR23: 管理、结算、更正和规则确认审计记录至少保留 180 天。
- NFR24: 核心用户流程以 WCAG 2.2 AA 为验收目标。
- NFR25: 所有核心操作必须可通过键盘完成，并具有可见焦点。
- NFR26: 输赢、盘口变化和状态不得仅依赖红绿颜色表达。
- NFR27: 页面字体放大至 200% 时，登录、加入房间、预测确认和查账流程仍可完成。
- NFR28: 动态余额、封盘、错误和结算状态必须提供可被辅助技术识别的文字信息。
- NFR29: 发布前至少完成自动化无障碍扫描及一次键盘、屏幕阅读器人工检查。
- NFR30: API-FOOTBALL 每个 `00:00 UTC` 计费日的请求总数不得超过 95；基准预算为静态 5、赛前赔率 10、滚球展示 70、最终赛果/结算/重试 10，其中最后 10 次为普通同步不可使用的最低保护额，官方配额剩余 5 次不得纳入业务调度。
- NFR31: 每次计费调用后，本地计数必须与供应商剩余额度响应头校验并采用更保守值；系统至少每日及发生不一致时使用不计费 `/status` 校准 `current` 与 `limit_day`，校准不得提高 95 次内部硬上限。
- NFR32: 目标比赛开放预测时，赛前赔率快照新鲜度不得超过 10 分钟；超过阈值立即停止接受新预测。
- NFR33: 存在活跃目标比赛且滚球预算充足时，滚球比分和赔率展示更新周期为 5～10 分钟；接近受保护额度时允许延长或停止更新，并明确显示最后更新时间，不宣称秒级实时。
- NFR34: 供应商异常、超时、额度不足或赔率超过 NFR32 阈值时，系统必须在检测后 10 分钟内且在下一次接受预测前，将受影响盘口标记为 `DATA_UNAVAILABLE`。
- NFR35: 用户页面请求触发供应商调用的数量必须为 0；外部请求失败时，所有用户读取继续命中产品缓存或获得明确不可用响应，不得回源绕过缓存。
- NFR36: 每个预测快照必须能够追溯到供应商、bookmaker、比赛、盘口、选择及数据时间。
- NFR37: 每次预测、冻结、结算、冲正和管理操作必须具有可关联的审计标识。
- NFR38: 超级管理员可以在 5 分钟内看到关键同步或结算任务失败状态。
- NFR39: 系统健康状态必须显示当日供应商请求量、剩余预算、最后同步时间、待结算任务和失败任务。
- NFR40: 内部时间判断统一使用可靠的服务器时间；用户本地时间仅用于展示。
- NFR41: 日志中不得记录完整恢复码、密码、会话令牌或可直接使用的邀请凭证。
- NFR42: 每个阶段发布前必须完成封盘竞态、重复提交、赢/输/走盘/取消/推迟、重复结算、赛果更正、`correction_debt` 抵扣、备份恢复及最坏比赛日 API 预算回放；通过标准为重复账务 0、无法解释账目差异 0、普通同步消耗保护额度 0、日请求不超过 95、备份恢复满足 NFR12，并保存验收证据至少 180 天。

### Additional Requirements

- Epic 1 Story 1 必须使用 `create-next-app@latest` 初始化 pnpm workspace，并建立 Web、Worker、共享 packages、CI、健康检查和配置验证基线。
- 生产基线为 Node.js 24 LTS、受支持的 PostgreSQL 18 minor、Next.js App Router、Drizzle migrations；实际依赖小版本由 lockfile 固定。
- Web 与 Worker 共享 application/domain services；Route Handler 和 Worker 不得复制业务规则。
- PostgreSQL 是积分、冻结、预测、任务、预算和审计的唯一强一致事实源；Phase 1 不依赖 Redis/WebSocket。
- 所有积分变化使用追加式 ledger 与原子余额更新；必须具备余额守恒、并发、幂等和冲正 integration tests。
- API 统一 `/api/v1`、camelCase JSON、UTC ISO 时间、稳定错误 code、`Idempotency-Key` 与 correlation id。
- API-FOOTBALL 必须通过单一 Adapter、持久快照、原子每日预算和结算保护池访问；页面请求不得回源。
- Worker 使用 PostgreSQL job table、租约、`FOR UPDATE SKIP LOCKED`、dedupe key 和指数退避。
- Session 使用 HttpOnly/Secure/SameSite Cookie；恢复码和邀请 token 仅存哈希；敏感操作需要重新认证。
- 部署以 Web + Worker 两进程及 PostgreSQL 为可移植基线；CI 必须覆盖 lint、typecheck、unit、integration、build 和主旅程 smoke。

### UX Design Requirements

UX-DR1: 实现 Editorial Matchday Ledger 视觉 token：纸张背景、墨色文本、球场绿主色、珊瑚强调色及符合 AA 的语义状态色。
UX-DR2: 使用 Source Serif 与 Noto Sans 字体层级，并保证字体加载失败时布局稳定、200% 放大可操作。
UX-DR3: 实现可复用 `AppShell`、顶部状态区、移动底部导航和桌面房间侧栏。
UX-DR4: 实现 `MatchCard`，同时表达比赛时间、状态、赔率更新时间、dataAsOf 和 stale/unavailable 状态。
UX-DR5: 实现 `OddsButton`，选中、变化、封盘和不可用状态不得只依赖颜色。
UX-DR6: 实现 `PredictionSlip` 与确认摘要，展示选择、赔率、投入、预计返还、余额影响及提交状态。
UX-DR7: 实现 `BalanceSummary`、`LedgerRow` 和 `SettlementExplanation`，使冻结、结算、冲正、债务可解释。
UX-DR8: 实现 `RoomSwitcher`、邀请加入确认、规则确认和邀请失效/重置恢复路径。
UX-DR9: 实现 `StatusBanner`/`InlineError`，为 MARKET_CLOSED、ODDS_CHANGED、DATA_UNAVAILABLE、INSUFFICIENT_POINTS 提供可执行恢复动作。
UX-DR10: 实现 skeleton、empty、loading、success、partial failure 与 retry 状态，避免仅用 toast 表达持久业务结果。
UX-DR11: 核心流程 mobile-first，覆盖 320px 手机、平板和桌面；提交按钮与关键状态在拇指触达区。
UX-DR12: 所有核心操作支持键盘、可见焦点、语义标签、屏幕阅读器状态通知和 `prefers-reduced-motion`。
UX-DR13: PWA 可安装并缓存只读 shell/最近数据；离线明确禁止预测提交和排队。
UX-DR14: 封盘倒计时只作展示，前台恢复/重新联网时立即同步服务端状态并处理过期草稿。
UX-DR15: 五条用户旅程均建立 Playwright smoke，包括注册恢复、邀请入房、封盘竞态、房主运营和超管异常处理。

### FR Coverage Map

- FR1: Epic 1 — 安全进入并恢复账户
- FR2: Epic 1 — 安全进入并恢复账户
- FR3: Epic 1 — 安全进入并恢复账户
- FR4: Epic 1 — 安全进入并恢复账户
- FR5: Epic 1 — 安全进入并恢复账户
- FR6: Epic 1 — 安全进入并恢复账户
- FR7: Epic 1 — 安全进入并恢复账户
- FR8: Epic 1 — 安全进入并恢复账户
- FR9: Epic 2 — 和朋友建立私人预测房间
- FR10: Epic 2 — 和朋友建立私人预测房间
- FR11: Epic 2 — 和朋友建立私人预测房间
- FR12: Epic 2 — 和朋友建立私人预测房间
- FR13: Epic 2 — 和朋友建立私人预测房间
- FR14: Epic 2 — 和朋友建立私人预测房间
- FR15: Epic 2 — 和朋友建立私人预测房间
- FR16: Epic 2 — 和朋友建立私人预测房间
- FR17: Epic 3 — 查看可信且有新鲜度保障的比赛数据
- FR18: Epic 3 — 查看可信且有新鲜度保障的比赛数据
- FR19: Epic 3 — 查看可信且有新鲜度保障的比赛数据
- FR20: Epic 3 — 查看可信且有新鲜度保障的比赛数据
- FR21: Epic 3 — 查看可信且有新鲜度保障的比赛数据
- FR22: Epic 3 — 查看可信且有新鲜度保障的比赛数据
- FR23: Epic 3 — 查看可信且有新鲜度保障的比赛数据
- FR24: Epic 3 — 查看可信且有新鲜度保障的比赛数据
- FR25: Epic 4 — 在封盘前安全提交积分预测
- FR26: Epic 4 — 在封盘前安全提交积分预测
- FR27: Epic 4 — 在封盘前安全提交积分预测
- FR28: Epic 4 — 在封盘前安全提交积分预测
- FR29: Epic 4 — 在封盘前安全提交积分预测
- FR30: Epic 4 — 在封盘前安全提交积分预测
- FR31: Epic 4 — 在封盘前安全提交积分预测
- FR32: Epic 4 — 在封盘前安全提交积分预测
- FR33: Epic 4 — 在封盘前安全提交积分预测
- FR34: Epic 4 — 在封盘前安全提交积分预测
- FR35: Epic 4 — 在封盘前安全提交积分预测
- FR36: Epic 2 — 和朋友建立私人预测房间
- FR37: Epic 2 — 和朋友建立私人预测房间
- FR38: Epic 2 — 和朋友建立私人预测房间
- FR39: Epic 4 — 在封盘前安全提交积分预测
- FR40: Epic 4 — 在封盘前安全提交积分预测
- FR41: Epic 5 — 获得可解释、可更正的自动结算
- FR42: Epic 5 — 获得可解释、可更正的自动结算
- FR43: Epic 8 — 扩展公开竞技与高级预测
- FR44: Epic 8 — 扩展公开竞技与高级预测
- FR45: Epic 8 — 扩展公开竞技与高级预测
- FR46: Epic 2 — 和朋友建立私人预测房间
- FR47: Epic 5 — 获得可解释、可更正的自动结算
- FR48: Epic 5 — 获得可解释、可更正的自动结算
- FR49: Epic 5 — 获得可解释、可更正的自动结算
- FR50: Epic 5 — 获得可解释、可更正的自动结算
- FR51: Epic 5 — 获得可解释、可更正的自动结算
- FR52: Epic 8 — 扩展公开竞技与高级预测
- FR53: Epic 8 — 扩展公开竞技与高级预测
- FR54: Epic 6 — 安全运营并守住非现金边界
- FR55: Epic 6 — 安全运营并守住非现金边界
- FR56: Epic 6 — 安全运营并守住非现金边界
- FR57: Epic 6 — 安全运营并守住非现金边界
- FR58: Epic 6 — 安全运营并守住非现金边界
- FR59: Epic 6 — 安全运营并守住非现金边界
- FR60: Epic 6 — 安全运营并守住非现金边界
- FR61: Epic 8 — 扩展公开竞技与高级预测
- FR62: Epic 8 — 扩展公开竞技与高级预测
- FR63: Epic 8 — 扩展公开竞技与高级预测
- FR64: Epic 9 — 让房间和战绩跨赛事延续
- FR65: Epic 7 — 在任何受支持设备上可靠参与
- FR66: Epic 7 — 在任何受支持设备上可靠参与
- FR67: Epic 7 — 在任何受支持设备上可靠参与
- FR68: Epic 7 — 在任何受支持设备上可靠参与
- FR69: Epic 6 — 安全运营并守住非现金边界
- FR70: Epic 6 — 安全运营并守住非现金边界
- FR71: Epic 6 — 安全运营并守住非现金边界
- FR72: Epic 6 — 安全运营并守住非现金边界

## Epic List

### Epic 1: 安全进入并恢复账户
普通用户可注册、登录、跨设备恢复；系统以完整角色边界保护普通用户、房主和两个预置超级管理员。
**Phase:** Phase 1
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8

### Epic 2: 和朋友建立私人预测房间
用户可创建/加入多个私人房间、管理邀请和规则，并在每房间获得独立且不可转让的初始积分账户。
**Phase:** Phase 1
**FRs covered:** FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR36, FR37, FR38, FR46

### Epic 3: 查看可信且有新鲜度保障的比赛数据
用户能查看比赛、赔率和数据状态；系统在 95 次供应商预算内缓存、降级并阻止过期数据参与预测。
**Phase:** Phase 1 + Phase 2 extension
**FRs covered:** FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR24

### Epic 4: 在封盘前安全提交积分预测
用户能理解赔率与返还、提交单项预测并在并发或赔率变化下获得一致结果；积分原子冻结且预测按时公开。
**Phase:** Phase 1 + Phase 2 extension
**FRs covered:** FR25, FR26, FR27, FR28, FR29, FR30, FR31, FR32, FR33, FR34, FR35, FR39, FR40

### Epic 5: 获得可解释、可更正的自动结算
用户能看到赢输退款、余额、账本和排行榜；系统可幂等结算、重试、冲正和处理更正债务。
**Phase:** Phase 1
**FRs covered:** FR41, FR42, FR47, FR48, FR49, FR50, FR51

### Epic 6: 安全运营并守住非现金边界
超级管理员可处理用户、房间、供应商与任务异常；所有敏感操作可审计且不能绕过账本或隐私边界。
**Phase:** Phase 1
**FRs covered:** FR54, FR55, FR56, FR57, FR58, FR59, FR60, FR69, FR70, FR71, FR72

### Epic 7: 在任何受支持设备上可靠参与
用户可通过响应式、可访问、可安装的 PWA 完成核心流程，并在离线/恢复连接时得到安全明确的状态。
**Phase:** Phase 1 hardening
**FRs covered:** FR65, FR66, FR67, FR68

### Epic 8: 扩展公开竞技与高级预测
正式产品用户可使用补分流程、高级盘口、串关、公开大厅、公开排行、长期战绩与分享卡。
**Phase:** Phase 2
**FRs covered:** FR43, FR44, FR45, FR52, FR53, FR61, FR62, FR63

### Epic 9: 让房间和战绩跨赛事延续
用户的房间、积分语境和历史能力可延续到世界杯之后的联赛与赛事。
**Phase:** Phase 3
**FRs covered:** FR64

## Detailed Epics and Stories

## Epic 1: 安全进入并恢复账户

用户获得完整可恢复身份，系统建立可持续实现基线。

### Story 1.1: 从 Starter Template 初始化项目工作区

As a 开发团队,
I want 获得可重复构建的 Web、Worker 与共享包工作区,
So that 后续用户能力能在一致边界和 CI 保护下增量交付.

**Requirements:** Architecture starter; NFR21; NFR42

**Acceptance Criteria:**

**Given** 空项目仅包含规划工件
**When** 执行已记录的 workspace 初始化与安装
**Then** 生成 apps/web、apps/worker、共享 packages、配置校验、健康检查和 frozen lockfile
**And** lint、typecheck、unit test 与 production build 在 CI/本地均可执行

**Given** 必需环境变量缺失
**When** Web 或 Worker 启动
**Then** 进程以不含密钥的明确配置错误失败
**And** live health 不依赖供应商，ready health 能识别数据库未就绪

### Story 1.2: 注册并一次性领取恢复码

As a 未注册用户,
I want 使用用户名和密码注册并确认 18+ 非现金规则,
So that 无需手机号邮箱也能安全开始使用.

**Requirements:** FR1, FR3, FR5; NFR15-NFR17

**Acceptance Criteria:**

**Given** 用户名可用且用户确认当前规则版本
**When** 提交合规密码完成注册
**Then** 账户创建且恢复码只展示一次、服务端仅存哈希
**And** 刷新或返回页面不会再次显示恢复码

**Given** 用户名重复、输入无效或未确认规则
**When** 提交注册
**Then** 注册被拒绝且不创建部分账户
**And** 错误提供可执行修正方式且不泄露账户敏感信息

### Story 1.3: 登录、退出与会话撤销

As a 已注册用户,
I want 安全登录、退出并在其他设备访问账户,
So that 可以持续使用且控制会话.

**Requirements:** FR2, FR8; NFR14, NFR17

**Acceptance Criteria:**

**Given** 账户启用且密码正确
**When** 用户登录
**Then** 创建安全 opaque session 并进入应用
**And** 退出后当前 session 立即失效

**Given** 账户已禁用或达到限流阈值
**When** 用户尝试登录或使用旧会话
**Then** 受保护访问被拒绝并记录安全事件
**And** 账户恢复后原有数据仍在但必须重新登录

### Story 1.4: 用恢复码重置访问凭证

As a 失去密码的用户,
I want 用用户名、有效恢复码和新密码恢复账户,
So that 换设备或遗忘密码后取回数据.

**Requirements:** FR3; NFR16-NFR17

**Acceptance Criteria:**

**Given** 恢复码有效且未使用
**When** 提交新密码
**Then** 旧恢复码和全部 session 失效，新恢复码只展示一次
**And** 历史房间、预测和账本保持不变

**Given** 恢复码错误、已用或请求超限
**When** 发起恢复
**Then** 不修改密码或 session
**And** 返回不便于枚举账户的稳定错误并记录安全事件

### Story 1.5: 管理昵称与角色边界

As a 普通用户,
I want 修改成员可见昵称并只看到被授权能力,
So that 在房间中可识别且权限不越界.

**Requirements:** FR4, FR6, FR7; NFR18-NFR19

**Acceptance Criteria:**

**Given** 普通用户已登录
**When** 更新合法昵称
**Then** 所有所属房间展示新昵称且账号身份不变
**And** 用户无法把自己提升为房主或超管

**Given** 系统首次 seed 或超管首次登录
**When** 创建两个超管或使用初始凭证
**Then** 恰好两个 super_admin 且首次登录强制改密
**And** 新增/替换超管只能走受控运维并留痕

## Epic 2: 和朋友建立私人预测房间

用户创建或加入私人房间，并获得独立积分语境。

### Story 2.1: 创建私人房间并确认规则

As a 已登录普通用户,
I want 创建私人房间并成为房主,
So that 能组织朋友预测局.

**Requirements:** FR9, FR10; UX-DR8

**Acceptance Criteria:**

**Given** 用户已确认账户规则
**When** 输入合法房间信息并确认房间规则
**Then** 创建私人房间、owner membership 和邀请能力
**And** 创建操作具有审计标识

**Given** 用户未确认当前房间规则
**When** 尝试创建
**Then** 创建被拒绝且无残留房间
**And** 界面链接到需确认的规则

### Story 2.2: 生成、重置并使用邀请

As a 房主和受邀用户,
I want 安全分享邀请并幂等加入房间,
So that 朋友能进入正确房间且旧邀请可撤销.

**Requirements:** FR11, FR12, FR37; UX-DR8

**Acceptance Criteria:**

**Given** 邀请有效且房间正常
**When** 已登录用户确认规则并加入
**Then** 创建一次 membership 和一次 10,000 初始积分流水
**And** 重复打开或重复提交不重复入房或发分

**Given** 房主重置邀请或房间受限/关闭
**When** 用户使用旧链接
**Then** 请求被拒绝且说明邀请失效或房间状态
**And** 既有成员、预测和账本不受重置影响

### Story 2.3: 切换房间并查看成员角色

As a 多房间成员,
I want 在房间间切换并查看成员角色,
So that 每个房间的上下文和积分不会混淆.

**Requirements:** FR13, FR14, FR36, FR38; UX-DR3, UX-DR8

**Acceptance Criteria:**

**Given** 用户属于多个房间
**When** 切换当前房间
**Then** 页面、余额、排行榜和预测查询全部使用目标 roomId
**And** 各房间账户独立且不会周期性重置

**Given** 用户构造非成员 roomId
**When** 请求房间数据
**Then** 服务端返回授权错误
**And** 不泄露房间是否存在或其成员信息

### Story 2.4: 房主查看提交状态而非选择

As a 房主,
I want 查看成员是否已提交,
So that 能推动参与而不破坏封盘前公平.

**Requirements:** FR15

**Acceptance Criteria:**

**Given** 比赛未封盘
**When** 房主查看成员列表
**Then** 只显示提交状态
**And** 不返回选择、赔率或投入

**Given** 比赛封盘
**When** 房主查看已公开预测
**Then** 按房间规则显示成员选择和投入
**And** 非成员仍不可访问

### Story 2.5: 举报违规房间并禁止积分转移

As a 房间成员,
I want 举报疑似真钱用途,
So that 维护非现金社区边界.

**Requirements:** FR16, FR46

**Acceptance Criteria:**

**Given** 用户是房间成员
**When** 提交原因和说明
**Then** 生成可审计举报并进入运营队列
**And** 不向房主暴露举报者敏感信息

**Given** 任何用户尝试购买、转让、赠送或兑换积分
**When** 调用产品能力
**Then** 系统不存在该能力或明确拒绝
**And** 不会产生余额或账本变化

## Epic 3: 查看可信且有新鲜度保障的比赛数据

用户只基于受预算保护、可追溯且足够新鲜的数据决策。

### Story 3.1: 同步并浏览目标比赛

As a 参与用户,
I want 浏览目标赛事、时间和状态,
So that 知道有哪些比赛可参与.

**Requirements:** FR17, FR19; NFR30-NFR31, NFR40

**Acceptance Criteria:**

**Given** 定时同步任务到期且普通预算可用
**When** Worker 领取任务
**Then** 经 Supplier Gateway 原子计费并版本化保存比赛快照
**And** 用户读取缓存而非直接调用供应商

**Given** 供应商报告改期开球
**When** 同步新快照
**Then** 服务端更新权威 kickoff 和状态
**And** 所有封盘判断使用 server UTC 而非浏览器时间

### Story 3.2: 查看赔率与数据状态

As a 参与用户,
I want 看到指定 bookmaker 1X2 赔率及新鲜度,
So that 能判断数据是否可用于提交.

**Requirements:** FR18, FR21, FR23; UX-DR4, UX-DR5

**Acceptance Criteria:**

**Given** 存在有效赔率快照
**When** 打开比赛或切换房间
**Then** 返回 odds、dataAsOf、状态和 ETag
**And** 重复刷新只访问产品缓存并支持条件响应

**Given** 快照同步中、过期或不可用
**When** 用户查看比赛
**Then** 状态以文字、图标和时间表达
**And** 不得只用颜色或伪装成实时数据

### Story 3.3: 只读查看滚球数据

As a 参与用户,
I want 查看滚球比分和赔率,
So that 获得比赛进展但不会误以为 Phase 1 可下注.

**Requirements:** FR20; NFR33

**Acceptance Criteria:**

**Given** 比赛进行中且滚球预算充足
**When** Worker 同步并用户查看
**Then** 展示 5–10 分钟级缓存及最后更新时间
**And** Phase 1 不出现滚球预测提交入口

**Given** 预算接近保护池
**When** 调度下一次滚球同步
**Then** 延长或停止刷新并显示 stale 状态
**And** 结算保护 10 次不被普通同步消耗

### Story 3.4: 过期或异常时关闭市场

As a 参与用户,
I want 在数据不可信时看到明确暂停,
So that 不会基于旧赔率提交.

**Requirements:** FR22; NFR32, NFR34-NFR36; UX-DR9

**Acceptance Criteria:**

**Given** 赔率超过 10 分钟、额度不足或无法验证
**When** 系统检测或收到提交
**Then** 市场进入 DATA_UNAVAILABLE 且拒绝新预测
**And** 拒绝在下一次接受预测前生效并保留数据来源追溯

**Given** 用户页面被刷新
**When** 缓存缺失或供应商异常
**Then** 返回明确不可用响应
**And** 页面请求绝不回源绕过预算守卫

### Story 3.5: 查看市场共识与模型赔率

As a Phase 2 用户,
I want 比较多 bookmaker 市场与模型赔率,
So that 获得更丰富但来源清晰的数据.

**Requirements:** FR24

**Acceptance Criteria:**

**Given** Phase 2 已启用且授权检查通过
**When** 用户查看高级赔率
**Then** MARKET 与 MODEL 明确分组并标注来源
**And** 模型值不冒充 bookmaker 赔率

**Given** 任一来源过期
**When** 渲染共识
**Then** 排除或标记过期来源
**And** 不得放宽提交所需新鲜度规则

## Epic 4: 在封盘前安全提交积分预测

用户在赔率和封盘竞态下仍获得原子且可解释的提交结果。

### Story 4.1: 建立预测单并预览返还

As a 房间成员,
I want 选择结果、输入积分并确认预测摘要,
So that 提交前理解风险和余额影响.

**Requirements:** FR25, FR26; UX-DR5, UX-DR6

**Acceptance Criteria:**

**Given** 盘口开放且余额充足
**When** 用户选择 1X2 并输入不超过 20,000
**Then** 显示确认赔率、投入、预计返还和提交前余额
**And** 输入超过可用余额或上限时无法确认并说明原因

**Given** 赔率或数据状态在编辑期间变化
**When** 确认界面刷新
**Then** 明确提示变化并更新摘要
**And** 不静默替换用户已确认赔率

### Story 4.2: 原子提交并冻结房间积分

As a 房间成员,
I want 安全提交赛前单项预测,
So that 成功响应对应唯一持久票单和冻结.

**Requirements:** FR27, FR28, FR31, FR32, FR39, FR40; NFR3-NFR8

**Acceptance Criteria:**

**Given** 盘口开放、实际开球前、快照新鲜且余额足够
**When** 带 Idempotency-Key 提交
**Then** 同一事务创建 ticket/快照/流水并 available 转 frozen
**And** 成功后重启进程数据仍存在

**Given** 20 个用户并发或同一用户双击
**When** 服务端重验并竞争账户/市场
**Then** 每个有效幂等键最多一张票和一次冻结
**And** 任一拒绝不生成票、不改变积分

### Story 4.3: 处理赔率变化、封盘和余额错误

As a 提交用户,
I want 收到明确拒绝与恢复动作,
So that 能在竞态下知道下一步.

**Requirements:** FR29, FR30; UX-DR9, UX-DR10

**Acceptance Criteria:**

**Given** 提交时赔率版本已变化
**When** 服务端验证快照
**Then** 返回 ODDS_CHANGED 和最新可确认摘要
**And** 用户重新确认前不得提交

**Given** 已实际开球、市场关闭、数据不可用或余额不足
**When** 用户提交
**Then** 分别返回稳定错误 code 和行动建议
**And** 错误响应带 correlationId 且积分变化为 0

### Story 4.4: 查看历史与封盘后公开预测

As a 房间成员,
I want 查看自己的历史并在封盘后比较成员选择,
So that 复盘决策且封盘前保持隐私.

**Requirements:** FR33, FR34

**Acceptance Criteria:**

**Given** 用户查看自己的历史
**When** 请求房间预测列表
**Then** 显示赔率快照、投入、状态和关联比赛
**And** 只能读取自己的完整历史

**Given** 市场从 open 进入 closed
**When** 成员查看房间预测
**Then** 封盘后公开成员选择和投入
**And** 封盘前响应不包含可被前端还原的隐藏字段

### Story 4.5: 提交高级盘口和串关

As a Phase 2 用户,
I want 提交让球、大小球、2–8 项串关与合规滚球预测,
So that 使用正式产品的高级玩法.

**Requirements:** FR35

**Acceptance Criteria:**

**Given** Phase 2 市场类型启用且每条腿有效
**When** 用户确认高级预测
**Then** 票单保存每腿快照和组合返还规则
**And** 仍遵守单张 20,000、余额、幂等和新鲜度

**Given** 任一腿封盘或变化
**When** 提交串关
**Then** 整张请求失败或要求重新确认
**And** 不得部分冻结或生成残缺票单

## Epic 5: 获得可解释、可更正的自动结算

用户的冻结、结算、冲正与排名始终可由账本解释。

### Story 5.1: 按最终状态结算赢输退款

As a 参与用户,
I want 让预测在最终赛果后自动结算,
So that 冻结积分转为可解释结果.

**Requirements:** FR41, FR47; NFR9

**Acceptance Criteria:**

**Given** 供应商确认 final 或 cancelled
**When** 结算 Worker 处理票单
**Then** 按合同执行赢、输、走盘或退款并只在最终返还 round_half_up 一次
**And** 推迟、中断或未确认保持冻结和 pending

**Given** 同一票含多个需要等待的条件
**When** 赛果未最终确认
**Then** 不提前释放或扣除冻结
**And** 状态和等待原因对用户可见

### Story 5.2: 幂等重试失败结算

As a 系统运营者,
I want 安全重试冻结、结算与退款任务,
So that 临时故障不会制造重复账务.

**Requirements:** FR48; NFR10, NFR38

**Acceptance Criteria:**

**Given** 任务失败并保持 pending
**When** Worker 或管理员用原输入重试
**Then** 以 ticket+settlementVersion+operation 唯一执行
**And** 重复运行不新增 ledger 或改变余额

**Given** Worker 租约过期后被另一实例领取
**When** 两个实例竞争同一 job
**Then** 数据库约束保证一次业务效果
**And** 失败在 5 分钟内对超管可见

### Story 5.3: 冲正并重结算更正赛果

As a 受赛果更正影响的用户,
I want 看到历史冲正和新结果,
So that 余额和排名反映最新权威赛果.

**Requirements:** FR49; NFR11

**Acceptance Criteria:**

**Given** 已结算 resultVersion 收到更正
**When** 系统创建新版本
**Then** 先追加 reversal 再按新结果结算并重算排名
**And** 原 ledger 不被修改或删除

**Given** 应扣回金额超过 available
**When** 应用冲正
**Then** available 降至 0、差额进入 correctionDebt
**And** 不改变其他预测 frozen，后续入账先抵债

### Story 5.4: 查看完整账本解释

As a 房间成员,
I want 查看每笔冻结、结算、退款和更正,
So that 自行解释余额变化.

**Requirements:** FR42, FR51; UX-DR7

**Acceptance Criteria:**

**Given** 账户有多种流水
**When** 用户打开账本或结算解释
**Then** 显示类型、金额、余额影响、ticket、room、版本和时间
**And** 补分与预测收益分开标记

**Given** 流水包含 reversal/debt offset
**When** 用户展开详情
**Then** 展示原结算与新结算关联链
**And** 所有金额使用精确小数而非浮点

### Story 5.5: 查看房间排行榜

As a 房间成员,
I want 查看余额、净收益和已结算预测排名,
So that 和朋友比较可解释战绩.

**Requirements:** FR50; NFR5

**Acceptance Criteria:**

**Given** 结算事务完成
**When** 成员刷新或轮询排行榜
**Then** 60 秒内看到新余额与排名
**And** 排名计算不包含冻结额且可追溯到账本

**Given** 发生赛果更正
**When** 重结算完成
**Then** 排行榜按新版本重算
**And** 不会同时展示相互矛盾的旧新结果

## Epic 6: 安全运营并守住非现金边界

运营异常可处理，敏感数据、账本和非现金边界不被破坏。

### Story 6.1: 查看受限的运营对象信息

As a 超级管理员,
I want 查看用户、房间与举报基本状态,
So that 定位问题而不获取不必要秘密.

**Requirements:** FR54; NFR18-NFR19

**Acceptance Criteria:**

**Given** 超管会话有效
**When** 查看运营页面
**Then** 返回允许的状态和关联举报
**And** 不返回密码、恢复码、完整 session 或未封盘选择

**Given** 普通用户请求 admin route
**When** 服务端授权
**Then** 返回拒绝且不渲染管理数据
**And** 访问尝试带 correlationId 记录

### Story 6.2: 禁用和恢复普通账户

As a 重新认证的超级管理员,
I want 控制违规账户状态,
So that 阻止继续操作并保留历史.

**Requirements:** FR55

**Acceptance Criteria:**

**Given** 重新认证在 5 分钟内有效
**When** 禁用账户并提供原因
**Then** 全部 session 撤销且受保护操作立即失败
**And** 原房间、预测和账本保留

**Given** 超管恢复账户
**When** 用户重新登录
**Then** 恢复访问原数据
**And** 恢复操作写入审计

### Story 6.3: 处理举报与房间状态

As a 重新认证的超级管理员,
I want 限制、关闭或恢复违规房间,
So that 执行非现金社区规则.

**Requirements:** FR56

**Acceptance Criteria:**

**Given** 存在举报且重新认证有效
**When** 限制或关闭房间
**Then** 新加入和新预测按状态被阻止
**And** 已有账本/预测不会删除

**Given** 房间恢复
**When** 成员重新访问
**Then** 符合规则的能力恢复
**And** 每次状态变化包含原因和审计标识

### Story 6.4: 监控供应商预算和任务

As a 超级管理员,
I want 查看配额、新鲜度、同步和结算任务,
So that 在数据异常时快速定位影响.

**Requirements:** FR57, FR39; UX-DR10

**Acceptance Criteria:**

**Given** 超管打开系统状态
**When** 读取产品监控数据
**Then** 显示当日各池消耗、剩余、最后同步、stale 市场、pending/failed jobs
**And** 数值来自持久预算和任务表而非进程内存

**Given** 本地计数与供应商 header/status 不一致
**When** 系统校准
**Then** 采用更保守值并记录差异
**And** 不得提高 95 次内部硬上限

### Story 6.5: 重新认证并安全重试任务

As a 超级管理员,
I want 用原幂等范围重试失败任务,
So that 恢复服务而不能篡改结果.

**Requirements:** FR58, FR59; NFR18

**Acceptance Criteria:**

**Given** 敏感操作前重新认证有效
**When** 选择失败任务重试
**Then** 创建指向原 payload/dedupe key 的 retry
**And** 不能编辑赔率快照、输入或结算结果

**Given** 超管尝试直接覆盖余额或删除记录
**When** 调用不存在或受禁接口
**Then** 操作被拒绝
**And** 不产生账本变化且记录安全事件

### Story 6.6: 保留完整运营与规则审计

As a 审计人员,
I want 追踪敏感动作和系统更正,
So that 能够重建关键运营历史.

**Requirements:** FR60; NFR23, NFR37, NFR41

**Acceptance Criteria:**

**Given** 发生列举的管理、邀请、规则、结算或凭证事件
**When** 系统处理动作
**Then** 写入 actor/target/action/result/time/correlationId
**And** 审计至少保留 180 天且敏感凭证脱敏

**Given** 动作失败或事务回滚
**When** 审计系统记录结果
**Then** 失败原因分类可查询
**And** 日志不包含可直接使用的 token/code

### Story 6.7: 删除账户时匿名化公开身份

As a 申请删除的用户,
I want 解除公开身份,
So that 行使隐私权而不破坏账本.

**Requirements:** FR69, FR70; NFR22

**Acceptance Criteria:**

**Given** 用户提交删除申请
**When** 流程在 7 天内处理
**Then** 私人页面不可公开索引且公开身份匿名化
**And** 只保留账本一致性需要的最小 pseudonymous 记录

**Given** 搜索引擎请求私人 route
**When** 抓取页面
**Then** 返回 noindex/授权保护
**And** 不泄露房间、排行榜或预测内容

### Story 6.8: 持续展示非现金规则边界

As a 所有用户,
I want 随时识别 18+ 与非现金属性,
So that 不会把积分理解为可兑现资产.

**Requirements:** FR71, FR72

**Acceptance Criteria:**

**Given** 用户访问任意页面
**When** 页面渲染
**Then** 固定展示简版声明并可打开完整规则
**And** 注册/创建/加入按版本要求确认

**Given** 用户寻找充值、提现、支付、奖品或外部下注
**When** 浏览产品和 API
**Then** 不存在这些入口或能力
**And** 积分无现金映射且无外部下注链接

## Epic 7: 在任何受支持设备上可靠参与

核心流程在手机、桌面、弱网和辅助技术下均可用。

### Story 7.1: 实现响应式应用外壳与设计系统

As a 手机和桌面用户,
I want 在一致界面中完成核心流程,
So that 不同设备上都能清楚操作.

**Requirements:** FR65; UX-DR1-UX-DR5, UX-DR11

**Acceptance Criteria:**

**Given** 视口为 320px、平板或桌面
**When** 用户浏览核心页面
**Then** AppShell、导航、MatchCard 和状态信息无水平阻塞
**And** 关键余额、封盘和提交操作保持可见可触达

**Given** 字体或自定义字体加载失败
**When** 页面渲染
**Then** token 与 fallback 字体保持层级和布局稳定
**And** 语义状态满足 AA 对比度

### Story 7.2: 安装和更新 PWA

As a 参与用户,
I want 将产品安装到设备,
So that 像应用一样快速返回而不强制安装.

**Requirements:** FR66, UX-DR13

**Acceptance Criteria:**

**Given** 浏览器支持安装
**When** 用户接受安装提示
**Then** manifest、icons 和 service worker 通过验证
**And** 未安装用户仍可完成全部核心流程

**Given** 新版本可用且用户正在填写预测
**When** service worker 更新
**Then** 不强制刷新或丢失草稿
**And** 在安全时机提示更新

### Story 7.3: 离线只读与恢复同步

As a 弱网用户,
I want 离线查看最近数据并在联网后刷新,
So that 不会把离线草稿误提交为有效预测.

**Requirements:** FR67, FR68; UX-DR13-UX-DR14

**Acceptance Criteria:**

**Given** 设备离线
**When** 用户打开已缓存页面
**Then** 只读内容明确标记 dataAsOf/offline
**And** 提交按钮禁用且不注册 background sync 写入

**Given** 恢复网络或页面回到前台
**When** 应用重新同步
**Then** 刷新 server state、封盘和余额
**And** 过期草稿要求重验而不自动发送

### Story 7.4: 完成无障碍核心流程

As a 键盘或辅助技术用户,
I want 独立完成注册、入房、预测和查账,
So that 获得与其他用户等价的体验.

**Requirements:** NFR24-NFR29; UX-DR12

**Acceptance Criteria:**

**Given** 仅使用键盘或屏幕阅读器
**When** 执行五条主旅程
**Then** 焦点顺序、标签、live status 和错误可理解
**And** 状态不只用颜色且 200% 放大仍可完成

**Given** 用户启用 reduced motion
**When** 界面发生状态变化
**Then** 非必要动画被移除或缩短
**And** 信息含义保持完整

### Story 7.5: 执行发布质量与恢复门禁

As a 产品负责人,
I want 在发布前获得可重复验收证据,
So that 高风险竞态和灾难恢复不会遗漏.

**Requirements:** NFR1-NFR5, NFR12-NFR13, NFR21, NFR29, NFR42; UX-DR15

**Acceptance Criteria:**

**Given** 候选版本准备发布
**When** CI 和验收套件运行
**Then** 性能、20 并发、主旅程、a11y、安全与预算回放均达阈值
**And** 重复账务、不可解释差异和保护池误用均为 0

**Given** 执行备份恢复演练
**When** 模拟数据丢失
**Then** RTO≤4h、RPO≤6h 且证据保存 180 天
**And** 任何阻断项使发布失败

## Epic 8: 扩展公开竞技与高级预测

Phase 2 增加公开竞技、补分与长期战绩而不污染预测收益。

### Story 8.1: 申请和审批私人房间补分

As a Phase 2 房间成员与房主,
I want 发起并审批补分,
So that 恢复参与同时保持预测收益纯净.

**Requirements:** FR43, FR45

**Acceptance Criteria:**

**Given** 成员提交补分申请
**When** 房主批准指定数量
**Then** 写 OWNER_GRANT 流水并增加房间 available
**And** 补分单独展示且不计入预测净收益

**Given** 房主拒绝或重复批准请求
**When** 处理同一申请
**Then** 至多产生一次 grant 或明确拒绝
**And** 不得修改历史预测收益

### Story 8.2: 使用公开大厅固定补分

As a Phase 2 用户,
I want 进入公开大厅并申请固定补分,
So that 获得公开竞技的独立积分语境.

**Requirements:** FR44, FR61, FR62

**Acceptance Criteria:**

**Given** 用户首次进入公开大厅
**When** 确认规则
**Then** 创建隔离账户并一次发放 10,000 SYSTEM_GRANT
**And** 可从大厅创建或加入私人房间

**Given** 用户申请公开补分
**When** 请求符合规则
**Then** 只发固定 10,000 且公开显示次数
**And** 幂等重试不重复发放

### Story 8.3: 查看公开榜与长期战绩

As a Phase 2 用户,
I want 比较公开排名和长期能力,
So that 理解跨房间表现而不混合余额.

**Requirements:** FR52, FR63

**Acceptance Criteria:**

**Given** 用户参与多个房间和公开大厅
**When** 查看长期资料
**Then** 显示阶段榜、命中率、虚拟收益率和擅长盘口
**And** 各房间余额独立且统计口径可解释

**Given** 统计包含补分
**When** 计算收益排名
**Then** 补分被排除并单独披露
**And** 私人房间敏感数据不进入公开视图

### Story 8.4: 生成隐私安全的战绩分享卡

As a Phase 2 用户,
I want 分享赛后表现,
So that 展示成绩而不泄露房间信息.

**Requirements:** FR53

**Acceptance Criteria:**

**Given** 存在已结算战绩
**When** 用户生成分享卡
**Then** 卡片只含允许的汇总和明确非现金声明
**And** 不含成员列表、邀请、账本明细或未封盘选择

**Given** 用户撤销或数据被更正
**When** 重新生成
**Then** 使用最新结算版本
**And** 旧链接按产品策略失效或标记过期

## Epic 9: 让房间和战绩跨赛事延续

Phase 3 将产品延展到世界杯后的赛事与长期档案。

### Story 9.1: 将房间扩展到世界杯后赛事

As a 长期房间成员,
I want 在英超、欧冠等赛事继续使用房间,
So that 保留朋友群和历史语境.

**Requirements:** FR64

**Acceptance Criteria:**

**Given** Phase 3 启用新 competition
**When** 房主或系统将赛事加入房间
**Then** 既有 membership 与账本历史保持，新的预测按赛事隔离可追溯
**And** 仍遵守非现金、授权、预算和封盘规则

**Given** 赛事结束或跨赛季
**When** 用户查看房间档案
**Then** 可按赛事/赛季筛选历史
**And** 不得重置或改写旧账本

### Story 9.2: 建立跨赛事历史档案

As a 长期用户,
I want 查看跨赛事荣誉和能力趋势,
So that 形成长期参与价值.

**Requirements:** Phase 3 scope; NFR11, NFR23

**Acceptance Criteria:**

**Given** 用户拥有多个赛事已结算记录
**When** 打开长期档案
**Then** 统计来自版本化结算和不可变账本
**And** 赛果更正会更新派生统计并保留审计链

**Given** 体育数据展示授权未完成
**When** 尝试公开新赛事素材
**Then** 发布 gate 阻止相关 Logo/媒体展示
**And** 基础文字数据也遵守供应商条款
