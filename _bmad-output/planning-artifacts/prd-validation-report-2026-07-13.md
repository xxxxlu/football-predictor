---
validationTarget: '/Users/xiaolu/Desktop/project-web/football-predictor/_bmad-output/planning-artifacts/prd.md'
validationDate: '2026-07-13'
inputDocuments:
  - '/Users/xiaolu/Desktop/project-web/football-predictor/_bmad-output/planning-artifacts/product-brief-football-predictor.md'
  - '/Users/xiaolu/Desktop/project-web/football-predictor/_bmad-output/planning-artifacts/product-brief-football-predictor-distillate.md'
  - '/Users/xiaolu/Desktop/project-web/football-predictor/_bmad-output/planning-artifacts/user-journey-blueprint.md'
validationStepsCompleted:
  - step-v-01-discovery
  - step-v-02-format-detection
  - step-v-03-density-validation
  - step-v-04-brief-coverage-validation
  - step-v-05-measurability-validation
  - step-v-06-traceability-validation
  - step-v-07-implementation-leakage-validation
  - step-v-08-domain-compliance-validation
  - step-v-09-project-type-validation
  - step-v-10-smart-validation
  - step-v-11-holistic-quality-validation
  - step-v-12-completeness-validation
validationStatus: COMPLETE
holisticQualityRating: '3/5 - Adequate'
overallStatus: Critical
remediationStatus: PARTIAL
simpleFixesApplied:
  - add-frontmatter-date
  - add-out-of-scope
  - add-journey-fr-traceability
  - mark-fr45-phase-2
  - remove-nfr15-implementation-preference
---

# PRD 验证报告

**待验证 PRD：** /Users/xiaolu/Desktop/project-web/football-predictor/_bmad-output/planning-artifacts/prd.md
**验证日期：** 2026-07-13

## 输入文档

- /Users/xiaolu/Desktop/project-web/football-predictor/_bmad-output/planning-artifacts/product-brief-football-predictor.md
- /Users/xiaolu/Desktop/project-web/football-predictor/_bmad-output/planning-artifacts/product-brief-football-predictor-distillate.md
- /Users/xiaolu/Desktop/project-web/football-predictor/_bmad-output/planning-artifacts/user-journey-blueprint.md

## 验证发现

[验证结果将在后续步骤中追加]

## 格式检测

**PRD 结构：**
- Executive Summary
- Project Classification
- Success Criteria
- Product Scope
- User Journeys
- Domain-Specific Requirements
- Innovation & Novel Patterns
- Web App Specific Requirements
- Project Scoping & Phased Development
- Functional Requirements
- Non-Functional Requirements

**BMAD 核心章节：**
- Executive Summary：存在
- Success Criteria：存在
- Product Scope：存在
- User Journeys：存在
- Functional Requirements：存在
- Non-Functional Requirements：存在

**格式分类：** BMAD Standard
**核心章节完整度：** 6/6

## 信息密度验证

**反模式违规：**

**对话式填充：** 0 处

**冗长表达：** 0 处

**重复表达：** 0 处

**违规总数：** 0

**严重度：** Pass

**建议：** PRD 信息密度良好，未发现工作流列举的填充、冗长或重复表达。

## Product Brief 覆盖验证

**Product Brief：** `product-brief-football-predictor.md`、`product-brief-football-predictor-distillate.md`

### 覆盖映射

**愿景陈述：** Fully Covered
- PRD Executive Summary、What Makes This Special 和 MVP Strategy 完整覆盖“免费足球判断账本”“真实赔率 × 虚拟积分”“自动封盘结算”“非现金边界”。

**目标用户：** Fully Covered
- 普通参与者和房主均有旅程及 FR；公开访客作为 Phase 2 用户被覆盖。PRD 另增两个预置超级管理员。

**问题陈述：** Fully Covered
- 群聊/表格无法维护赛程、赔率、积分与排名，以及普通竞猜过于简单、真钱产品边界不适配，均在 Executive Summary、Market Context 中体现。

**关键功能：** Partially Covered
- 赔率快照、独立房间积分、冻结账本、封盘、自动结算、排行榜、补分、公开大厅、串关和数据预算均已进入范围或 FR。
- **Critical divergence：** Brief 明确“不使用密码，昵称建立本地身份”，PRD Phase 1 改为“用户名和密码注册登录”（PRD 51、137、541～544 行；FR1～FR3）。
- **Moderate divergence：** Brief 的世界杯验证轨仅一个邀请链接房间且不实现恢复码/多房间；PRD Phase 1 要求自助创建、多房间和恢复码（PRD 137～140、530～550 行；FR3、FR9、FR13）。

**目标/成功标准：** Fully Covered
- 30 秒加入、60 秒首单、3～10 人连续三场、60% 参与、4 人访谈、API ≤95、零过期提交、零重复账务与结算成功率均被覆盖。

**差异化：** Fully Covered
- 非普通比分竞猜、非真钱产品、无需重运营、账目可解释四项均被保留。

**约束：** Partially Covered
- 95 次请求、共享缓存、10 次结算保护、滚球只读、单一 bookmaker、授权检查、非现金约束均覆盖。
- Brief 中 `/status` 校准、00:00 UTC 重置、具体预算拆分 `5/10/70/10` 未形成 FR/NFR 能力合同，仅在上游输入存在。

### 覆盖总结

**总体覆盖：** 高（约 90%），但存在 1 项关键产品决策冲突和 2 项阶段/预算契约缺口。

**Critical Gaps：** 1
- 身份模型从“昵称 + 本地身份 + 恢复码、无密码”变为“用户名 + 密码 + 恢复码”，未说明决策变更来源。

**Moderate Gaps：** 2
- 恢复码、自助创建和多房间从正式产品轨前移到 Phase 1，扩大世界杯验证轨。
- 请求预算只在 NFR30 固化总额与保护额，缺少 `5/10/70/10` 分配、UTC 重置与校准约束。

**Informational Gaps：** 0

**建议：** 在 PRD 中明确身份模型和 Phase 1 范围的最新批准决策；若 PRD 的改动是有意覆盖 Brief，应记录 supersedes 关系，否则应恢复 Brief 的验证轨边界。

## 可测量性验证

### Functional Requirements

**分析总数：** 72

**格式违规：** 0
- FR 均具有明确 actor 和可执行 capability，编号连续为 FR1～FR72。

**主观形容词：** 1
- **FR30（680 行）：** “明确原因和可执行的恢复方式”缺少允许的拒绝原因/恢复动作集合或验收定义。

**模糊量词/边界：** 5
- **FR8（649 行）：** “受保护功能”未枚举。
- **FR22（669 行）：** “额度不足或数据无法验证”未在 FR 中绑定明确状态/触发条件。
- **FR35（685 行）：** “符合数据条件的滚球预测”未定义数据条件。
- **FR60（719 行）：** “关键管理操作”未定义范围。
- **FR70（735 行）：** “维持账本一致性所必需的最小记录”未定义保留字段与期限。

**实现细节泄漏：** 0
- FR 中的 API-FOOTBALL、bookmaker、状态码和账本类型属于产品/集成契约，不按技术实现泄漏计数。

**FR 违规总数：** 6

### Non-Functional Requirements

**分析总数：** 42

**缺少度量指标：** 2
- **NFR17（765 行）：** 要求登录失败限流，但没有次数、时间窗、退避或解锁指标。
- **NFR18（766 行）：** 30 分钟空闲超时可测，但“关键管理操作”重新认证的操作集合和重新认证有效期未定义。

**模板不完整：** 9
- **NFR1（743 行）：** 缺少移动设备、网络条件与采样/测量方法。
- **NFR2～NFR3（744～745 行）：** 引用 NFR4 并发提交负载，但赛事/排行榜读路径的读负载模型未定义，也未注明测量方法。
- **NFR5（747 行）：** 缺少 60 秒可见性的起止事件与测量方式。
- **NFR12（757 行）：** 有备份、RTO/RPO 指标，但缺少恢复验证频率/成功判据（NFR42 仅要求演练）。
- **NFR15（763 行）：** “符合当前 OWASP 建议”会漂移，且 Argon2id 只是优先项；没有最低参数或可引用基线版本。
- **NFR29（780 行）：** 要求扫描和人工检查，但没有允许问题等级/通过标准。
- **NFR34（788 行）：** “一个同步周期”依赖未固定的调度周期；无法形成稳定时限。
- **NFR42（799 行）：** 要求演练，但没有演练成功判据和证据保存要求。

**缺少上下文：** 2
- **NFR2～NFR3：** 未定义正常读流量、缓存冷热状态、数据规模。
- **NFR13（758 行）：** 99% 可用性只针对单个比赛窗口，未说明多比赛重叠时如何聚合统计。

**NFR 违规总数：** 13

### 总体评估

**需求总数：** 114（72 FR + 42 NFR）
**违规总数：** 19

**严重度：** Critical（按 BMAD 本步骤阈值：>10）

**建议：** 在进入架构前补齐身份/登录安全、数据新鲜度、读负载、恢复演练及数据保留的可测试边界；其余能力可在 UX/架构并行细化，但必须回写 PRD 契约。

## 可追溯性验证

### 链路验证

**Executive Summary → Success Criteria：** Intact
- “快速进入、免费非现金、自动运行、可解释账本、受控数据成本”均有用户、业务或技术成功指标。

**Success Criteria → User Journeys：** Intact
- 进入/首单由 Journey 1；封盘与赔率竞态由 Journey 2；无人工维护与跨赛事延续由 Journey 3；API 配额、暂停、结算与更正由 Journey 4；公开产品延展由 Journey 5 支撑。

**User Journeys → Functional Requirements：** 语义覆盖完整，但显式追踪有缺口
- 蓝图约定 FR 使用 `FR-J{旅程号}-{序号}`，PRD 实际使用 FR1～FR72，且没有 source/journey 字段；下游无法机械验证追溯关系。

**Scope → FR Alignment：** Misaligned
- Phase 1 身份模型、恢复码、自助创建和多房间相较 Brief 验证轨发生前移，未记录范围决策。
- **FR45** 未标 Phase 2，但其唯一业务来源 FR43/FR44 均为 Phase 2 补分；应标 Phase 2 或改写为“存在补分时”的跨阶段规则。

### 孤立元素

**孤立 Functional Requirements：** 0
- FR70 虽未出现在五条叙事旅程中，但可追溯到 Domain-Specific Requirements 的隐私/数据删除目标。
- FR66～FR69 可追溯到 Web App Specific Requirements 和 PWA 产品形态。

**无旅程支撑的 Success Criteria：** 0

**无 FR 支撑的用户旅程：** 0

### 追踪矩阵

| 旅程 | 主要 FR | 覆盖结论 |
|---|---|---|
| Journey 1 首次参加 | FR1～FR5、FR9～FR15、FR17～FR21、FR25～FR34、FR36～FR42、FR47～FR51、FR65～FR72 | 完整 |
| Journey 2 封盘瞬间提交 | FR18～FR23、FR25～FR32、FR40、FR47～FR49 | 完整 |
| Journey 3 房主组织与维持 | FR9～FR16、FR34、FR36～FR45、FR47～FR51、FR56、FR60、FR64、FR71～FR72 | 完整，含 Phase 2/3 |
| Journey 4 超管处理数据异常 | FR6～FR8、FR17～FR23、FR28～FR32、FR47～FR49、FR54～FR60 | 完整；10 次保护额在 NFR30 |
| Journey 5 公开参与者 | FR24、FR35、FR43～FR45、FR52～FR53、FR61～FR64 | 完整，均属 Phase 2/3 |

**追溯问题总数：** 3
- 1 项显式编号/来源链缺口。
- 2 项 Scope → FR 阶段对齐问题（身份/范围前移；FR45 阶段标签）。

**严重度：** Warning

**建议：** 保留现有 FR 编号也可以，但应增加 `Source Journey` 映射表并明确 PRD 是否 supersede 两份 Brief 的身份和验证轨范围。

## 实现细节泄漏验证

### 分类结果

**Frontend Frameworks：** 0

**Backend Frameworks：** 0

**Databases：** 0

**Cloud Platforms：** 0

**Infrastructure：** 0

**Libraries：** 0

**其他实现细节：** 1
- **NFR15（763 行）：** “优先采用 Argon2id”指定实现算法但又不是硬性验收契约。建议 PRD 固定可验证的密码哈希安全基线/最低参数，把算法选择留给架构；如果 Argon2id 是强制产品安全决策，则改为明确 SHALL 而非“优先”。

### 可接受的能力/约束术语

- **FR66 PWA：** 产品形态能力。
- **NFR14 HTTPS：** 可验证的传输安全约束。
- **NFR20/NFR30 API-FOOTBALL：** 已选外部依赖和计费契约。
- **NFR21 OWASP ASVS 5.0 L1：** 可引用的安全验收标准。

### 总结

**实现细节泄漏总数：** 1

**严重度：** Pass（本步骤阈值 <2）

**建议：** 仅需处理 NFR15 的“优先实现”措辞；其余 FR/NFR 基本保持 WHAT 而非 HOW。

## 领域合规验证

**Domain：** `sports_data_social_prediction`
**Complexity：** Medium（PRD 自分类；BMAD `domain-complexity.csv` 无精确条目）

本项目不是 BMAD 表中定义的 fintech：PRD 明确不含支付、充值、提现、兑换或资金托管。但赔率表现、站外真钱滥用风险、18+、个人数据和体育数据展示权构成需要显式契约的领域边界，因此没有按 general 直接跳过。

### 领域覆盖矩阵

| 领域要求 | 状态 | FR/NFR 证据与缺口 |
|---|---|---|
| 非现金、不可兑换、无支付/下注入口 | Met | FR46、FR71、FR72；Domain 348～353 行 |
| 违规房间举报、限制和关闭 | Met | FR16、FR56；FR59 限制超管破坏账本 |
| 18+ 使用边界 | Partial | FR5 覆盖注册确认；但 FR12 加入房间没有再次确认当前规则，且未定义年龄声明版本变更后的重新确认 |
| 规则版本与确认审计 | Partial | FR5、FR10、FR60、NFR23；缺少“加入房间确认”的 FR，和 PRD 352/592 行冲突 |
| 数据最小化、访问隔离、删除 | Met | FR69～FR70；NFR14～NFR23；Domain 355、386 行 |
| 体育数据来源与快照可追溯 | Met | FR18～FR24、FR60；NFR30～NFR36 |
| 体育数据、Logo、商标及派生赔率展示授权 | Partial | Domain 374～375 行和 Phase 2 Scope 156/609 行存在，但 FR/NFR 没有“公共大厅开放前授权检查通过”的发布门禁；FR60 只要求保存条款版本 |
| 不抓取外围站点、不链接下注平台 | Met | FR72；Integration Requirements 373 行 |

### 总结

**要求项：** 8
**完整满足：** 5
**部分满足：** 3
**缺失：** 0

**严重度：** Warning

**建议：**
1. 补充“加入私人房间前确认当前规则版本”的 FR，并定义规则更新后的重确认策略。
2. 为 Phase 2 增加明确 FR/NFR 发布门禁：体育数据、Logo、商标、缓存和派生赔率展示授权未确认时不得开放公共展示。
3. 18+ 当前仅为自我声明方案；应在 PRD 中明确这是 Phase 1 的批准控制及其验收方式。

## 项目类型合规验证

**Project Type：** `web_app`

### 必需章节

| BMAD 必需项 | 状态 | PRD 位置 |
|---|---|---|
| browser_matrix | Present | Browser Matrix（448～459 行） |
| responsive_design | Present | Responsive Design（461～468 行） |
| performance_targets | Present | Performance Targets（470～477 行）及 NFR1～NFR5 |
| seo_strategy | Present | SEO Strategy（479～485 行）及 FR69 |
| accessibility_level | Present | Accessibility Level（487～498 行）及 NFR24～NFR29 |

### 不应存在的章节

| BMAD 排除项 | 状态 | 说明 |
|---|---|---|
| native_features | Absent | 原生 Android/iOS 明确长期排除 |
| cli_commands | Absent | 无 CLI 范围 |

### 合规总结

**必需章节：** 5/5
**错误出现的排除章节：** 0
**合规分数：** 100%

**严重度：** Pass

**建议：** 项目类型信息足以启动 Web UX；性能目标的测试条件仍按可测量性章节补齐。

## SMART Functional Requirements 验证

**Functional Requirements 总数：** 72

### 评分摘要

**所有分项 ≥3：** 91.7%（66/72）
**所有分项 ≥4：** 86.1%（62/72）
**总体平均分：** 4.31/5.0

### 逐条评分

| FR | Specific | Measurable | Attainable | Relevant | Traceable | Average | Flag |
|---|---:|---:|---:|---:|---:|---:|---|
| FR1 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR2 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR3 | 4 | 4 | 4 | 5 | 3 | 4.0 |  |
| FR4 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR5 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR6 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR7 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR8 | 2 | 2 | 4 | 4 | 4 | 3.2 | X |
| FR9 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR10 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR11 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR12 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR13 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR14 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR15 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR16 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR17 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR18 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR19 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR20 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR21 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR22 | 2 | 2 | 4 | 5 | 4 | 3.4 | X |
| FR23 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR24 | 3 | 3 | 3 | 4 | 4 | 3.4 |  |
| FR25 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR26 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR27 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR28 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR29 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR30 | 2 | 2 | 4 | 5 | 4 | 3.4 | X |
| FR31 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR32 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR33 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR34 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR35 | 2 | 2 | 3 | 5 | 4 | 3.2 | X |
| FR36 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR37 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR38 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR39 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR40 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR41 | 3 | 3 | 4 | 5 | 4 | 3.8 |  |
| FR42 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR43 | 5 | 5 | 4 | 5 | 4 | 4.6 |  |
| FR44 | 5 | 5 | 4 | 5 | 4 | 4.6 |  |
| FR45 | 4 | 4 | 5 | 4 | 3 | 4.0 |  |
| FR46 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR47 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR48 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR49 | 5 | 5 | 4 | 5 | 4 | 4.6 |  |
| FR50 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR51 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR52 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR53 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR54 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR55 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR56 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR57 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR58 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR59 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR60 | 2 | 2 | 4 | 4 | 4 | 3.2 | X |
| FR61 | 5 | 5 | 4 | 5 | 4 | 4.6 |  |
| FR62 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR63 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR64 | 5 | 5 | 4 | 5 | 4 | 4.6 |  |
| FR65 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR66 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR67 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR68 | 4 | 4 | 4 | 5 | 4 | 4.2 |  |
| FR69 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR70 | 2 | 2 | 4 | 4 | 4 | 3.2 | X |
| FR71 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |
| FR72 | 5 | 5 | 5 | 5 | 4 | 4.8 |  |

**图例：** 1=差，3=可接受，5=优秀；`X` 表示至少一项低于 3。

### 低分 FR 改进建议

- **FR8：** 枚举禁用账户不可使用的功能，并规定已存在会话、公开只读页面及恢复后的行为。
- **FR22：** 绑定 `QUOTA_PROTECTED`/`DATA_UNAVAILABLE` 等状态及 10 次保护额度、新鲜度阈值触发条件。
- **FR30：** 建立拒绝原因与恢复动作矩阵，至少覆盖 `MARKET_CLOSED`、`ODDS_CHANGED`、`DATA_UNAVAILABLE`、`INSUFFICIENT_POINTS` 和重复请求。
- **FR35：** 将滚球开放条件写成可验收 gate：更新频率、最大数据年龄、供应商覆盖、结算回放数量及授权状态。
- **FR60：** 枚举必须审计的管理操作、规则确认事件和数据来源/条款字段。
- **FR70：** 定义删除后保留的匿名账本字段、保留期、去标识方法和不可恢复标识。

### 总体评估

**严重度：** Pass（6/72 = 8.3% 被标记，低于 10%）

**建议：** FR 整体质量可用；先修复六条低分 FR，并增加 Journey 显式来源列，便于 UX、架构和 Story 自动追踪。

## 整体质量评估

### 文档流与一致性

**评估：** Good

**优点：**
- 从愿景、成功指标、五条旅程、领域约束、Web 要求、分阶段范围到 FR/NFR，叙事顺序完整。
- 72 FR 和 42 NFR 编号连续，结构适合人工审阅和 LLM 提取。
- 非现金边界、服务端封盘、账本可解释性、API 成本约束贯穿全文。

**改进点：**
- Product Scope 与 Project Scoping 重复描述 Phase 1～3，且与两个 Brief 的身份/验证轨范围不一致；没有单一 supersedes 决策。
- “注册登录 + 恢复码”只给能力列表，没有足够的恢复、轮换、吊销、冲突和管理员凭证生命周期规则。
- 积分与结算在叙事上完整，但 FR 契约没有固定 Phase 1 的赢/输/取消/推迟返还公式和更正状态机。

### 双受众有效性

**对人类：**
- Executive-friendly：良好，产品定位与非现金边界可快速理解。
- Developer clarity：一般；核心竞态与账本方向清晰，但身份、恢复、结算状态、预算调度仍需产品决策。
- Designer clarity：一般偏好；五条旅程与响应式要求充分，但认证恢复、邀请失效、错误恢复和角色操作闭环不完整。
- Stakeholder decision-making：一般；缺少对上游范围变更的明确批准记录。

**对 LLM：**
- Machine-readable structure：优秀。
- UX readiness：部分就绪；不能唯一推导登录/恢复/邀请失效流程。
- Architecture readiness：部分就绪；不能唯一推导结算状态机、恢复安全模型及完整 API 预算调度。
- Epic/Story readiness：基本就绪，但 Journey 来源无法机械追踪，容易产生阶段错配。

**双受众评分：** 3.5/5

### BMAD 原则

| 原则 | 状态 | 说明 |
|---|---|---|
| Information Density | Met | 0 项典型密度反模式 |
| Measurability | Partial | 6 条 FR 低分，NFR 测试条件存在 13 项缺口 |
| Traceability | Partial | 五条旅程语义覆盖，但未遵循 `FR-J...` 或提供显式映射 |
| Domain Awareness | Met | 非现金、18+、隐私、数据来源与授权均有专章 |
| Zero Anti-Patterns | Met | 无明显填充或大面积 HOW 泄漏 |
| Dual Audience | Partial | 结构好，但关键决策不能唯一推导 |
| Markdown Format | Met | 标题层级、表格、编号和 frontmatter 清晰 |

**完全满足：** 4/7

### 总体质量评级

**评分：** 3/5 — Adequate

PRD 已具备强结构和较完整能力面，但关键产品契约仍存在上游冲突或未闭环，当前不应直接作为 UX 与架构的唯一真值源。

### 最重要的三项改进

1. **锁定身份、角色与 Phase 1 唯一范围**
   明确 PRD 是否取代 Brief；确定用户名密码还是昵称本地身份，并定义恢复码、两个超管账号生命周期及验证轨是否支持多房间。

2. **把积分与结算规则提升为可执行契约**
   固定冻结/返还公式、实际余额含义、推迟/取消/中断/更正状态机、冲正顺序与幂等键作用域；Phase 2 再补半赢半输和串关矩阵。

3. **补齐数据预算、授权及追踪门禁**
   将 `5/10/70/10`、UTC 重置、剩余额度校准、10 次保护降级策略写入可测试 NFR；为公共展示增加授权 gate，并建立 Journey→FR 映射。

## 完整性验证

### 模板完整性

**残留模板变量：** 0

未发现 `{variable}`、`{{variable}}`、TODO、TBD 或 placeholder。✓

### 核心章节内容完整性

**Executive Summary：** Complete
- 愿景、目标用户、差异化、数据约束和阶段概览齐全。

**Success Criteria：** Complete
- 用户、业务和技术成功指标齐全且大多量化。

**Product Scope：** Incomplete
- Phase 1～3 存在，但没有独立 Out of Scope/长期排除清单；范围与 Brief 的身份及验证轨边界未统一。

**User Journeys：** Complete
- 五条旅程覆盖普通用户、房主、超级管理员及 Phase 2 公开参与者。

**Functional Requirements：** Incomplete
- 72 条 FR 编号完整，但恢复码、加入规则确认、结算结果矩阵、API 预算调度和授权 gate 仍缺必要能力契约。

**Non-Functional Requirements：** Incomplete
- 42 条 NFR 编号完整；部分缺度量方法、负载上下文或通过标准。

### 章节专项完整性

**Success Criteria 可测量：** All（主要指标均有目标值；少数测量方法可在分析计划补充）

**User Journeys 覆盖所有用户：** Yes

**FR 覆盖 MVP：** Partial
- Phase 1 能力面均出现，但身份恢复、邀请失效、结算状态与数据预算无法仅凭 FR 唯一实现。

**NFR 具有具体标准：** Some
- 29/42 可直接形成明确验收；13 项需要补充测试上下文、方法或阈值。

### Frontmatter 完整性

**stepsCompleted：** Present
**classification：** Present
**inputDocuments：** Present
**date：** Missing（存在 `completedAt` 和正文 Date，但无独立 frontmatter `date` 字段）

**Frontmatter 完整度：** 3/4

### 完整性总结

**核心章节存在：** 6/6
**内容完全完整：** 3/6（其余 3 节为 Incomplete，而非 Missing）

**Critical Gaps（章节缺失/模板残留）：** 0

**Minor Gaps：** 4
- Product Scope 缺独立 Out of Scope 且阶段基线未统一。
- FR 能力契约存在若干闭环缺口。
- NFR 有 13 项可测试性不足。
- frontmatter 缺 `date`。

**严重度：** Warning

**建议：** 所有 BMAD 必需章节均存在；完成上述内容补齐后再将该 PRD 作为下游唯一真值源。

## 最终汇总与阶段准入

### 总体结论

**BLOCKED**（BMAD `overallStatus: Critical`）

PRD 是 BMAD Standard，结构、信息密度、Web 项目类型、核心竞态和非现金边界总体良好；但身份模型、Phase 1 范围、恢复/邀请闭环、结算契约和 API 配额调度仍不能从 PRD 唯一推导。当前不适合作为 `bmad-create-ux-design` 与 `bmad-create-architecture` 的唯一输入真值源。

### 重点验证结论

| # | 验证重点 | 结论 | PRD / FR / NFR 依据 |
|---:|---|---|---|
| 1 | Phase 1～3 范围一致性 | **Blocked**：PRD 将密码登录、恢复码、自助建房、多房间前移到 Phase 1，与两份 Brief 的验证轨冲突；FR45 阶段标签不一致 | Product Scope 135～163；Project Scoping 526～616；FR3、FR9、FR13、FR43～FR45 |
| 2 | 普通用户、房主、两个超管 | **Pass with fixes**：角色权限主体完整；两个超管的初始凭证交付、轮换/恢复、账号替换及“关键操作”范围不完整 | Project Classification 75；FR6～FR8、FR9～FR16、FR54～FR60；NFR18～NFR19 |
| 3 | 注册登录、恢复码、私人房间、邀请 | **Blocked**：注册登录模型与 Brief 冲突；恢复码缺生成后的查看、使用、轮换、吊销、冲突流程；邀请重置未在 FR 固定旧链接失效及已加入成员保留；加入规则确认缺 FR | FR1～FR5、FR9～FR13；Domain 352；NFR14～NFR18 |
| 4 | 独立积分、10,000、20,000、冻结结算 | **Pass with fixes**：房间隔离、初始分、单张上限和冻结一致；Phase 1 赢/输/取消/推迟的返还公式及余额含义未成为明确 FR 契约 | FR25、FR31～FR32、FR36～FR42、FR47～FR49；NFR6～NFR11 |
| 5 | 封盘、实际开球、赔率变化、过期、并发 | **Pass**：服务端权威、开球兜底、10 分钟赛前新鲜度、`MARKET_CLOSED`/`ODDS_CHANGED` 和零账本副作用一致 | Success Criteria 104～112；FR19、FR21～FR23、FR28～FR32；NFR7、NFR32、NFR34、NFR40 |
| 6 | API 每日 95、结算保护 10、缓存 | **Blocked**：总限额、保护额和共享缓存明确，但 `5/10/70/10` 分配、00:00 UTC 重置、`/status` 校准和预算切换算法未进入 FR/NFR | FR22～FR23、FR57；NFR30～NFR35；Brief 数据预算章节 |
| 7 | 自动结算、幂等、更正、冲正账本 | **Pass with fixes**：自动结算、重试、冲正、不覆盖历史完整；缺 Phase 1 取消/推迟/中断状态矩阵，Phase 2 还缺半赢半输/串关完整测试向量 | FR41、FR47～FR49、FR51、FR58～FR59；NFR9～NFR11、NFR37、NFR42 |
| 8 | 非现金、18+、隐私、数据授权 | **Pass with fixes**：非现金和隐私较完整；加入房间规则确认、规则更新重确认、公共展示前体育数据/Logo/派生赔率授权 gate 未进入 FR/NFR | FR5、FR10、FR12、FR16、FR46、FR56、FR69～FR72；NFR14～NFR23、NFR36 |
| 9 | 五条旅程追溯 FR | **Pass with fixes**：五条旅程均有 FR 支撑、无 orphan；未遵循蓝图 `FR-J...` 约定，也无 Source Journey 矩阵 | User Journeys 165～342；FR1～FR72 |
| 10 | 72 FR / 42 NFR 质量 | **Needs fixes**：FR 编号完整，6 条 SMART 低分；NFR 有 13 项度量/上下文缺口；实现泄漏仅 NFR15 一项 | FR8、FR22、FR30、FR35、FR60、FR70；NFR1～NFR5、NFR12～NFR18、NFR29、NFR34、NFR42 |
| 11 | UX/架构只依赖 PRD 启动 | **No**：结构足够，但关键身份流程与技术业务契约不能唯一推导 | Holistic Quality 3/5；上述 blocker |
| 12 | 进入 UX 与架构阶段 | **No / No**：修复 blocker 后重新验证 | 本节阶段准入 |

### 必须修复的 Blocker

1. **统一身份模型与 Phase 1 范围基线**
   - 明确 PRD 是否 supersede 两份 Brief。
   - 在“用户名+密码”与“昵称+本地身份”中确定唯一方案。
   - 固定恢复码、自助建房、多房间是否属于 Phase 1。
   - 对应：Product Scope、Project Scoping；FR1～FR3、FR9、FR13；NFR14～NFR18。

2. **闭环恢复码、邀请与两个超级管理员账户生命周期**
   - 恢复码生成、显示一次、摘要保存、使用、轮换、吊销、冲突与丢失处理。
   - 邀请重置后旧链接失效、已加入成员保留；加入房间确认当前规则版本。
   - 两个超管的初始凭证、强制轮换、恢复/替换和关键操作重新认证。
   - 对应：FR3、FR5～FR8、FR10～FR12、FR54～FR60；NFR15～NFR18、NFR23。

3. **固定 Phase 1 积分与结算状态机**
   - 明确定义冻结后可用/总余额、赢的返还是否含本金、输/走盘/取消/推迟/中断处理、最终状态确认、冲正顺序和幂等键作用域。
   - Phase 2 另列亚洲盘半赢半输、串关取消项及高级盘口测试矩阵。
   - 对应：FR39～FR42、FR47～FR49、FR51；NFR6～NFR11、NFR37、NFR42。

4. **把 API 配额策略变成可执行 NFR 契约**
   - 固化 `5/10/70/10`、95 硬上限、10 保护额、UTC 重置、剩余额度校准、降频/停止条件和最坏比赛日回放验收。
   - 对应：FR22～FR23、FR57；NFR30～NFR35、NFR42。

### 建议修复项

1. 为五条旅程增加 Journey→FR 显式矩阵，或恢复 `FR-J{旅程号}-{序号}` 编号约定。
2. 将 FR45 标注为 Phase 2；明确 FR24、FR35 的开放 gate。
3. 修订低分 FR8、FR22、FR30、FR35、FR60、FR70。
4. 补齐 NFR1～NFR5 的设备/网络/负载/测量方法，以及 NFR12、NFR17～NFR18、NFR29、NFR34、NFR42 的通过标准。
5. 增加公共大厅上线前体育数据、Logo、商标、缓存和派生赔率授权检查的 FR/NFR gate。
6. 增加独立 Out of Scope，并在 frontmatter 增加 `date`。

### 阶段准入结论

- **`bmad-create-ux-design`：暂不进入。** 身份、恢复、邀请失效和角色操作流程尚不能唯一设计。
- **`bmad-create-architecture`：暂不进入。** 结算状态机、恢复安全模型和 API 预算调度尚不能唯一落架构。
- **建议顺序：** 先使用 `bmad-edit-prd` 修复四项 blocker，再重新运行 `bmad-validate-prd`；通过后同时进入 UX 与架构。

### 快速结果

| 检查 | 结果 |
|---|---|
| 格式 | BMAD Standard，6/6 核心章节 |
| 信息密度 | Pass，0 项 |
| Brief 覆盖 | 约 90%，1 项关键冲突 |
| 可测量性 | Critical，19 项 |
| 可追溯性 | Warning，3 项；0 orphan |
| 实现泄漏 | Pass，1 项 |
| 领域合规 | Warning，5/8 完整、3/8 部分 |
| Web App 合规 | Pass，100% |
| SMART FR | 91.7% 可接受，平均 4.31/5 |
| 整体质量 | 3/5 — Adequate |
| 完整性 | 6/6 章节存在，3/6 内容完整 |

## 简单修复记录

**应用日期：** 2026-07-13
**状态：** PARTIAL — 已完成用户选择的全部简单项；总体仍为 BLOCKED。

### 已修复

1. **FR45 阶段错配：** 已标记为 `FR45（Phase 2）`。
2. **NFR15 实现泄漏：** 已移除“优先采用 Argon2id”，改为可验证的 NFR21 适用控制和版本化安全评审证据。
3. **Frontmatter 日期：** 已增加 `date: 2026-07-13`。
4. **Out of Scope：** 已新增全阶段排除小节，仅整理 PRD 与输入文档中已有排除项。
5. **Journey→FR 追踪：** 已在 User Journeys 后增加五条旅程的 FR 与阶段映射表。

### 修复后仍存在的 Blocker

- 身份模型和 Phase 1 范围仍未统一：FR1～FR3、FR9、FR13。
- 恢复码、邀请失效和两个超级管理员账户生命周期仍未闭环：FR3、FR6～FR8、FR11～FR12、FR54～FR60；NFR17～NFR18。
- Phase 1 积分结算状态机仍不完整：FR39～FR42、FR47～FR49；NFR6～NFR11。
- API 配额调度仍未形成完整可执行契约：FR22～FR23、FR57；NFR30～NFR35。

**阶段准入维持不变：** 暂不进入 `bmad-create-ux-design` 或 `bmad-create-architecture`。
