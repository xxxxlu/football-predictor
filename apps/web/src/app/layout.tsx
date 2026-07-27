import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { APPLE_TOUCH_ICON } from "./icons";
import { LocaleProvider } from "@/components/locale-provider";
import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale, translate } from "@/lib/i18n/locale";
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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value ?? DEFAULT_LOCALE);
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full">
        <LocaleProvider initialLocale={locale}>
          <a className="skip-link" href="#main-content">{translate(locale, "skipToContent")}</a>
          <OfflineStatusBanner />
          {children}
          <ServiceWorkerRegister />
        </LocaleProvider>
      </body>
    </html>
  );
}
