"use client";

import { useState } from "react";
import { useApi } from "@/lib/api/admin";
import { AdminPagination, ErrorBanner, PageHeader, Table } from "@/components/admin/ui";

type AuditEntry = {
  id: number;
  adminId?: string | null;
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  summary: Record<string, unknown>;
  at: string;
};

/** 操作记录：管理员 id、操作、对象、时间与变更摘要（只读）。 */
export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<{
    items: AuditEntry[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }>(`/api/admin/audit?page=${page}`);

  return (
    <div>
      <PageHeader title="操作记录" />
      {loading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : error ? (
        <ErrorBanner error={error} onReload={reload} />
      ) : data ? (
        <>
          <p className="label-mono mb-3 text-ink-muted">共 {data.total} 条</p>
          <Table head={["时间", "操作者", "操作", "对象", "摘要"]}>
            {data.items.map((entry) => (
              <tr key={entry.id} className="hover:bg-surface-sunk">
                <td className="label-mono whitespace-nowrap px-4 py-3 text-ink-muted">
                  {new Date(entry.at).toLocaleString("zh-CN")}
                </td>
                <td className="px-4 py-3">
                  <span className="label-mono-sm">{entry.actor}</span>
                  {entry.adminId ? <span className="label-mono-sm ml-2 text-ink-muted">{entry.adminId.slice(0, 8)}</span> : null}
                </td>
                <td className="label-mono px-4 py-3">{entry.action}</td>
                <td className="label-mono px-4 py-3 text-ink-muted">
                  {entry.objectType}:{entry.objectId.slice(0, 8)}
                </td>
                <td className="max-w-[420px] truncate px-4 py-3 text-[13px] text-ink-muted">
                  {Object.keys(entry.summary ?? {}).length > 0 ? JSON.stringify(entry.summary) : "—"}
                </td>
              </tr>
            ))}
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                  还没有操作记录
                </td>
              </tr>
            ) : null}
          </Table>
          <AdminPagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : null}
    </div>
  );
}
