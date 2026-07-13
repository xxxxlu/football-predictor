import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "看球账本 · Matchday Ledger",
    short_name: "看球账本",
    description: "和朋友用虚拟积分记录足球判断。无充值、提现或兑换。",
    start_url: "/rooms",
    scope: "/",
    display: "standalone",
    background_color: "#F4F0E6",
    theme_color: "#F4F0E6",
    orientation: "portrait-primary",
    categories: ["sports", "social"],
    lang: "zh-CN",
    icons: [
      { src: "/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/app-icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "比赛", short_name: "比赛", url: "/matches" },
      { name: "我的房间", short_name: "房间", url: "/rooms" },
    ],
  };
}
