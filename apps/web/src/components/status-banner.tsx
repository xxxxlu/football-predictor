import { StatusMessage } from "./status-message";

export function StatusBanner({ kind, timestamp }: { kind: "stale" | "closed" | "unavailable" | "offline"; timestamp?: string }) {
  const content = {
    stale: ["数据可能已过期", timestamp ? `最后更新：${new Date(timestamp).toLocaleString("zh-CN")}` : "提交前会由服务端再次确认。"],
    closed: ["本场已经封盘", "无法再提交判断；已有积分不会因此发生变化。"],
    unavailable: ["比赛数据暂不可用", "为保护你的积分，当前暂停提交。请稍后重试。"],
    offline: ["当前处于离线状态", "可以查看已加载内容，但不会离线排队提交判断。"],
  } as const;
  return <StatusMessage tone={kind === "stale" ? "info" : "error"} title={content[kind][0]}>{content[kind][1]}</StatusMessage>;
}
