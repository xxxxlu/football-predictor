import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { APPLE_TOUCH_ICON } from "./icons";
import { LocaleProvider } from "@/components/locale-provider";
import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale, translate } from "@/lib/i18n/locale";
import { OddsFormatProvider } from "@/components/odds-format-provider";
import { OfflineStatusBanner } from "@/features/pwa/offline-status";
import { ServiceWorkerRegister } from "@/features/pwa/service-worker-register";
import { InstallPrompt } from "@/features/pwa/install-prompt";
import { MagneticCursor } from "@/components/magnetic-cursor";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PULSE SPORTS CLUB", template: "%s · PULSE" },
  description: "每一刻，都有判断。足球、F1，和朋友一起预测，用虚拟积分留下每一次判断。无现金、不可兑换。",
  applicationName: "PULSE",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PULSE",
  },
  icons: { apple: APPLE_TOUCH_ICON },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0c0e",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value ?? DEFAULT_LOCALE);
  return (
    <html lang={locale} className="dark h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full" suppressHydrationWarning>
        <LocaleProvider initialLocale={locale}>
          <OddsFormatProvider>
            <a className="skip-link" href="#main-content">{translate(locale, "skipToContent")}</a>
            <MagneticCursor />
            <OfflineStatusBanner />
            {children}
            <ServiceWorkerRegister />
            <InstallPrompt />
          </OddsFormatProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
