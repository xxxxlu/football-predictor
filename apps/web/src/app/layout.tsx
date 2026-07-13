import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "@/features/pwa/service-worker-register";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "看球账本", template: "%s · 看球账本" },
  description: "和朋友用虚拟积分记录足球判断。无现金、不可兑换。",
  applicationName: "看球账本",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F4F0E6" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
