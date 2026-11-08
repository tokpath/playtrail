import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Bricolage_Grotesque } from "next/font/google";
import "@/app/globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
});

export const metadata: Metadata = {
  title: { default: "PlayTrail 管理后台", template: "%s — PlayTrail 管理后台" },
  robots: { index: false, follow: false },
};

/** Admin root layout: Chinese-only admin UI (DESIGN §6.7), 14px base via the
 * shell; never cached, never indexed. */
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className={display.variable}>
      <body className="bg-paper text-ink">{children}</body>
    </html>
  );
}
