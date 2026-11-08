"use client";

import { useState } from "react";
import Link from "next/link";
import { adminApi, useApi, type SourceChange } from "@/lib/api/admin";
import { Button, ConfirmDialog, ErrorBanner, PageHeader, Table } from "@/components/admin/ui";

/** 变更待复核（PRD §22.7）：接受写入草稿，忽略保持现状；不自动改写已发布内容。 */
export default function AdminChangesPage() {
  const [state, setState] = useState("pending");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ change: SourceChange; action: "accept" | "ignore" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const list = useApi<{ items: SourceChange[]; total: number; page: number }>(
    `/api/admin/source-changes?state=${state || "pending"}&page=${page}`,
  );

  const resolve = async () => {
    if (!confirm) return;
    const { change, action } = confirm;
    setConfirm(null);
    setBusy(true);
    try {
      await adminApi.resolveChange(change.id, action);
      setNotice({ text: action === "accept" ? "已采纳：差异已写入草稿修订，请到游戏中复核。" : "已忽略。", ok: true });
      list.reload();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "操作失败", ok: false });
    } finally {
      setBusy(false);
    }
  };

  const formatValue = (v: unknown) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

  return (
    <div>
      <PageHeader
        title="变更待复核"
        actions={
          <select value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} className="h-9 rounded-input border border-hairline bg-surface px-3 text-[13px]">
            <option value="pending">待复核</option>
            <option value="accepted">已采纳</option>
            <option value="ignored">已忽略</option>
          </select>
        }
      />
      {notice ? (
        <p className={`mb-4 text-[13px] ${notice.ok ? "text-moss" : "text-signal"}`}>{notice.text}</p>
      ) : null}

      {list.loading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : list.error ? (
        <ErrorBanner error={list.error} onReload={list.reload} />
      ) : list.data ? (
        <>
          <Table head={["游戏", "字段", "旧值", "新值", "发现时间", ""]}>
            {list.data.items.map((change) => (
              <tr key={change.id} className="transition-colors hover:bg-surface-sunk">
                <td className="px-4 py-3">
                  {change.gameSlug ? (
                    <Link href={`/admin/games/${change.gameId}`} className="text-ink hover:underline">
                      {change.gameSlug}
                    </Link>
                  ) : (
                    <span className="label-mono-sm text-ink-muted">{change.gameId}</span>
                  )}
                </td>
                <td className="label-mono px-4 py-3 text-ink-muted">{change.field}</td>
                <td className="max-w-[220px] truncate px-4 py-3 text-[13px] text-ink-muted">{formatValue(change.oldValue)}</td>
                <td className="max-w-[220px] truncate px-4 py-3 text-[13px]">{formatValue(change.newValue)}</td>
                <td className="label-mono px-4 py-3 text-ink-muted">
                  {new Date(change.detectedAt).toLocaleString("zh-CN")}
                </td>
                <td className="px-4 py-3 text-right">
                  {change.state === "pending" ? (
                    <span className="space-x-2">
                      <Button
                        onClick={() => setConfirm({ change, action: "accept" })}
                        disabled={busy}
                      >
                        采纳
                      </Button>
                      <Button danger onClick={() => setConfirm({ change, action: "ignore" })} disabled={busy}>
                        忽略
                      </Button>
                    </span>
                  ) : (
                    <span className="label-mono-sm text-ink-muted">{change.state === "accepted" ? "已采纳" : "已忽略"}</span>
                  )}
                </td>
              </tr>
            ))}
            {list.data.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                  没有待复核的变更
                </td>
              </tr>
            ) : null}
          </Table>
          {list.data.total > list.data.items.length ? (
            <div className="mt-4 flex justify-between">
              <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>← 上一页</Button>
              <Button disabled={list.data.items.length < 10} onClick={() => setPage(page + 1)}>下一页 →</Button>
            </div>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={confirm != null}
        title={confirm?.action === "accept" ? "采纳该变更？" : "忽略该变更？"}
        body={
          confirm?.action === "accept"
            ? "采纳会把新值写入草稿修订（不影响已发布内容），请在游戏中复核后再发布。"
            : "忽略后该条差异不再提示，已发布内容保持不变。"
        }
        confirmLabel={confirm?.action === "accept" ? "确认采纳" : "确认忽略"}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => void resolve()}
      />
    </div>
  );
}
