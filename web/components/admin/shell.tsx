"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { adminApi } from "@/lib/api/admin";
import { Button } from "./ui";

const NAV = [
  { href: "/admin", label: "概览" },
  { href: "/admin/games", label: "游戏" },
  { href: "/admin/source", label: "来源目录" },
  { href: "/admin/changes", label: "变更待复核" },
  { href: "/admin/hot", label: "热门快照" },
  { href: "/admin/import", label: "导入" },
  { href: "/admin/dict", label: "字典" },
  { href: "/admin/stats", label: "统计" },
  { href: "/admin/crawler", label: "爬虫" },
  { href: "/admin/audit", label: "操作记录" },
];

/** Auth guard: /api/admin/me decides; a 401 anywhere navigates to login. */
export function Guard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"checking" | "ok" | "denied">("checking");

  useEffect(() => {
    let alive = true;
    adminApi
      .me()
      .then(() => alive && setState("ok"))
      .catch(() => alive && setState("denied"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (state === "denied") {
      router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [state, pathname, router]);

  if (state !== "ok") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-[14px] text-ink-muted">正在验证登录状态…</div>
    );
  }
  return <>{children}</>;
}

/** Admin shell (DESIGN §6.7): 232px sidebar, denser 14px base, content ≤1280. */
export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState("");

  useEffect(() => {
    adminApi.me().then((me) => setEmail(me.email)).catch(() => {});
  }, []);

  const logout = async () => {
    await adminApi.logout().catch(() => {});
    router.replace("/admin/login");
  };

  return (
    <div className="min-h-dvh bg-paper text-[14px] leading-relaxed text-ink">
      <div className="flex">
        <aside className="sticky top-0 flex h-dvh w-[232px] shrink-0 flex-col border-r border-hairline bg-surface">
          <div className="flex h-14 items-center gap-2 border-b border-hairline px-4">
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M3 14 C 6 8, 10 12, 15 4" fill="none" stroke="var(--trail)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 5" />
              <circle cx="3" cy="14" r="2.6" fill="var(--ink)" />
              <circle cx="9" cy="4" r="2.6" fill="var(--trail)" />
            </svg>
            <span className="font-display text-[15px] font-bold tracking-tight">PlayTrail 管理后台</span>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
            {NAV.map((item) => {
              const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex h-9 items-center rounded-[10px] px-3 transition-colors ${
                    active ? "bg-ink text-paper" : "text-ink hover:bg-surface-sunk"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-hairline p-3">
            <p className="label-mono-sm truncate text-ink-muted">{email}</p>
            <Button className="mt-2 w-full" onClick={logout}>
              退出登录
            </Button>
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1280px] px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
