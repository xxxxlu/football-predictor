import type { Metadata, Viewport } from "next";
import { APPLE_TOUCH_ICON } from "./icons";
import { OfflineStatusBanner } from "@/features/pwa/offline-status";
import { ServiceWorkerRegister } from "@/features/pwa/service-worker-register";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PULSE SPORTS CLUB", template: "%s · PULSE" },
  description: "每一刻，都有判断。足球、F1，和朋友一起预测，用虚拟积分留下每一次判断。无现金、不可兑换。",
  applicationName: "PULSE",
  icons: { apple: APPLE_TOUCH_ICON },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0b0b" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        <OfflineStatusBanner />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
