"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AdminApiError } from "@/lib/api/admin";

/** Shared admin UI primitives (DESIGN §6.7): status pills, review dots,
 * confirm dialog with reason, page headers, pagination, field errors. */

const STATUS_ZH: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  unlisted: "已下架",
  suspect: "链接可疑",
  invalid: "链接失效",
  valid: "链接有效",
  unchecked: "未检查",
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  placeholder: "占位",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`label-mono-sm inline-flex h-6 items-center rounded-full px-2.5 ${
        status === "published" || status === "valid" || status === "approved"
          ? "bg-moss/10 text-moss"
          : status === "suspect" || status === "invalid" || status === "rejected"
            ? "bg-signal/10 text-signal"
            : status === "pending"
              ? "bg-amber/10 text-amber"
              : "border border-hairline bg-surface text-ink-muted"
      }`}
    >
      {STATUS_ZH[status] ?? status}
    </span>
  );
}

/** Per-locale review dot: pending amber, approved moss, rejected signal. */
export function ReviewDot({ state }: { state: string }) {
  const color =
    state === "approved" ? "bg-moss" : state === "rejected" ? "bg-signal" : "bg-amber";
  return <span aria-hidden="true" className={`inline-block size-2 rounded-full ${color}`} />;
}

export function PageHeader({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      {children}
    </div>
  );
}

export const inputCls =
  "h-10 rounded-input border border-hairline bg-surface px-3 text-[14px] text-ink placeholder:text-ink-muted focus:border-trail focus:outline-none";

export function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="mt-1 text-[12px] text-signal">{error}</p>;
}

export function Labeled({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label-mono-sm mb-1.5 block text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[12px] text-ink-muted">{hint}</span> : null}
      <FieldError error={error} />
    </label>
  );
}

/** Buttons follow DESIGN §4.3 at admin density: 36px secondary; danger uses signal. */
export function Button({
  children,
  variant = "secondary",
  danger,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; danger?: boolean }) {
  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center rounded-input px-3.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${className} ${
        variant === "primary"
          ? "bg-trail text-trail-ink"
          : danger
            ? "border border-signal/40 text-signal hover:bg-signal/10"
            : "border border-hairline bg-surface text-ink hover:border-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** Shared destructive-action confirm dialog: focus trap, Esc, optional reason. */
export function ConfirmDialog({
  open,
  title,
  body,
  children,
  confirmLabel = "确认",
  requireReason = false,
  reasonPlaceholder = "请填写原因（必填）",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  requireReason?: boolean;
  reasonPlaceholder?: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState("");
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    // Reset the reason on open (React "adjust state on prop change" pattern).
    setWasOpen(true);
    setReason("");
  }
  if (!open && wasOpen) setWasOpen(false);

  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    if (!root) return;
    const first = root.querySelector<HTMLElement>("input, textarea, button");
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...root.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')];
      if (items.length === 0) return;
      const firstEl = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[480px] rounded-card border border-hairline bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-[17px] font-semibold text-ink">{title}</h2>
        {body ? <div className="mt-2 text-[13px] leading-relaxed text-ink-muted">{body}</div> : null}
        {children ? <div className="mt-4 space-y-2">{children}</div> : null}
        {requireReason ? (
          <input
            type="text"
            value={reason}
            maxLength={500}
            placeholder={reasonPlaceholder}
            onChange={(e) => setReason(e.target.value)}
            className={`${inputCls} mt-4 w-full`}
          />
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            danger
            disabled={busy || (requireReason && reason.trim().length === 0)}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </Button>
        </div>
        <div className="sr-only">Esc 关闭</div>
      </div>
    </div>
  );
}

/** Admin pagination: 上一页 / 下一页 + page status, keyboard accessible. */
export function AdminPagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-5 flex items-center justify-between">
      <Button disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← 上一页
      </Button>
      <span className="label-mono text-ink-muted">
        第 {page} / {totalPages} 页
      </span>
      <Button disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        下一页 →
      </Button>
    </div>
  );
}

/** Data table wrapper per DESIGN §6.7: mono header, hairline rows, hover. */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-hairline bg-surface">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="label-mono-sm whitespace-nowrap px-4 py-2.5 text-left text-ink-muted">
                {h}
              </th>
            ))}
          </tr>
          <tr aria-hidden="true">
            {head.map((h) => (
              <th key={h} className="border-t border-hairline" />
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">{children}</tbody>
      </table>
    </div>
  );
}

/** Error banner with requestId for unexpected API failures. */
export function ErrorBanner({ error, onReload }: { error: AdminApiError; onReload?: () => void }) {
  return (
    <div className="rounded-card border border-signal/40 bg-signal/5 px-4 py-3 text-[13px] text-signal">
      <p>
        {error.message}
        {error.requestId ? <span className="ml-2 font-mono text-[11px] opacity-70">（requestId: {error.requestId}）</span> : null}
      </p>
      {onReload ? (
        <Button className="mt-2" onClick={onReload}>
          重试
        </Button>
      ) : null}
    </div>
  );
}
