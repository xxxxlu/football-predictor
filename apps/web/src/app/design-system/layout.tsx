import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { absolute: "PULSE SPORTS CLUB" },
  description: "PULSE 多运动社交预测平台品牌原型。",
  applicationName: "PULSE SPORTS CLUB",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080909",
};

export default function PulseDesignSystemLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
