import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VCT 2026 晋级计算器",
  description: "VCT 2026 Champions qualification probability calculator",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
