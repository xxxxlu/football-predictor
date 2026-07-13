import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Football Predictor",
  description: "Non-cash football prediction with private rooms",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
