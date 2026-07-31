# ADR 0001: 新增 `club` PG schema 承载每日互动域

- 状态：Accepted
- 日期：2026-07-31
- 关联：Story 12.2（每日体育挑战与运势）、Epic 12（PULSE CLUB）、architecture.md L242（架构例外先更新 ADR）

## 背景

架构文档将 PG schema 清单视为封闭集合（identity / room / prediction / ledger / product / ops / f1），新开 schema 属架构例外，需先立 ADR。Story 12.1 据此把好友表放进 `identity`（好友本质是账户间关系，归属成立）。Story 12.2 引入每日挑战、XP、连胜、徽章——这些既不是账户关系，也绝不允许与积分/账本/预测发生任何数据关联（PRD L204、FR59、Epic 12 隔离声明）。

## 决定

新增 `club` PG schema，承载 12.2 的三张表（`daily_challenge_attempts` / `engagement_profiles` / `badge_awards`）及 12.4 大厅频道的后续表。

## 理由

1. **物理隔离是本域的核心验收，独立 schema 让它在 schema 层面可审计**：`club.*` 只允许对 `identity.users` 的外键，schema 断言测试用正则证明迁移不含 room/prediction/ledger 引用、不含 `numeric(20,2)` 金额列。放进任何既有 schema 都会稀释这条不变量。
2. **先例完整**：0017 为 F1 开出 `f1` schema（一 schema 一子域一仓储目录），本 ADR 沿用同一布局，仅补上 f1 当时缺的字据。
3. **服务后续故事**：12.4 的大厅/频道同属 club 子域，一次立据两次受益。

## 后果

- 迁移 0024 起 `club` schema 进入 ready 探针比对的迁移目录，部署换芯必须同步。
- 领域 `packages/domain/src/club/`、仓储 `packages/db/src/club/` 与 schema 一一对应。
- 未来任何试图从 `club.*` 建 FK/join 到积分、账本、预测域的变更，都需先修订本 ADR——评审时以此为打回依据。
