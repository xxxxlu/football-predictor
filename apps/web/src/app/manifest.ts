import type { MetadataRoute } from "next";
import { MANIFEST_ICONS } from "./icons";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PULSE SPORTS CLUB · 赛事脉搏",
    short_name: "PULSE",
    description: "每一刻，都有判断。足球、F1，和朋友一起用虚拟积分记录体育判断。无充值、提现或兑换。",
    start_url: "/rooms",
    scope: "/",
    display: "standalone",
    background_color: "#0a0b0b",
    theme_color: "#0a0b0b",
    orientation: "portrait-primary",
    categories: ["sports", "social"],
    lang: "zh-CN",
    icons: MANIFEST_ICONS,
    shortcuts: [
      { name: "赛事", short_name: "赛事", url: "/matches" },
      { name: "我的房间", short_name: "房间", url: "/rooms" },
    ],
  };
}
