"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { adminApi, AdminApiError } from "@/lib/api/admin";
import { Button, inputCls } from "@/components/admin/ui";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminApi.login(email.trim(), password);
      router.replace(search.get("next") || "/admin");
    } catch (err) {
      if (err instanceof AdminApiError) {
        setError(
          err.status === 401
            ? "邮箱或密码不正确"
            : err.status === 429
              ? "尝试次数过多，请 15 分钟后再试"
              : `${err.message}${err.requestId ? `（requestId: ${err.requestId}）` : ""}`,
        );
      } else {
        setError("登录失败，请重试");
      }
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-[380px] rounded-card border border-hairline bg-surface p-6">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M3 14 C 6 8, 10 12, 15 4" fill="none" stroke="var(--trail)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 5" />
            <circle cx="3" cy="14" r="2.6" fill="var(--ink)" />
            <circle cx="9" cy="4" r="2.6" fill="var(--trail)" />
          </svg>
          <span className="font-display text-[17px] font-bold tracking-tight">PlayTrail 管理后台</span>
        </div>
        <h1 className="mt-5 font-display text-[20px] font-semibold">管理员登录</h1>
        <label className="mt-5 block">
          <span className="label-mono-sm mb-1.5 block text-ink-muted">邮箱</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputCls} w-full`}
          />
        </label>
        <label className="mt-4 block">
          <span className="label-mono-sm mb-1.5 block text-ink-muted">密码</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputCls} w-full`}
          />
        </label>
        {error ? <p className="mt-4 text-[13px] text-signal">{error}</p> : null}
        <Button type="submit" variant="primary" disabled={busy} className="mt-6 w-full">
          {busy ? "登录中…" : "登录"}
        </Button>
      </form>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
