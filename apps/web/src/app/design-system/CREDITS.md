# PULSE 原型素材来源档案

> 对应 SoT §17.2（图片策略）与 §12.4（赛道图版权要求）。所有素材须可追溯。

## 已使用

### 赛道轮廓（circuits.ts）
- **来源**：[bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) — GeoJSON 格式的 F1 赛道数据
- **许可**：MIT License，Copyright (c) 2019-2025 Tomislav Bacinger
- **处理**：GeoJSON 坐标经等距圆柱投影（cos(lat) 修正）转换为 400×320 viewBox 的 SVG path，抽稀至 2px 精度，由本仓库自行渲染
- **合规性**：非 F1 官方图形资产；该仓库自带免责声明（与 Formula One Licensing B.V. 无关联）。我方渲染为抽象轮廓线，符合 SoT「背景使用该分站赛道的抽象路径，但不能直接复制 F1 官方赛道图资产」
- **已收录**：Silverstone（gb-1948）、Spa-Francorchamps（be-1925）；Phase 5 可按 2026 赛历补齐其余分站

## 待办（网络受限，暂缺）

### 车手照片 / 赛车照片
- **首选合法来源**：Wikimedia Commons 的 CC BY / CC BY-SA 授权照片（车手肖像、赛车照片均有大量存量）
- **现状**：2026-07-17 当前开发机网络到 wikipedia.org / wikimedia.org 为 SSL 阻断，无法直接拉取
- **落地方式（三选一）**：
  1. 网络可达时下载 CC 授权图 → 放入 `apps/web/public/design-system/drivers/`，**每张图在本文件登记：文件名 / 作者 / 许可证 / 来源 URL**（CC BY-SA 需在页面可见处署名）
  2. 采购图库授权（Getty/Shutterstock 体育包）
  3. v1 不用人像：车队色条 + 车号 + 三字码（计时塔现行方案），头盔配色做识别位
- **禁止**：直接抓取 formula1.com / ferrari.com / nba.com 官网图片作生产素材（SoT §17.2）
