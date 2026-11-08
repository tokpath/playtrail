"use client";

import { useState } from "react";
import { adminApi, type ImportPreview, type ImportResult } from "@/lib/api/admin";
import { Button, ConfirmDialog, ErrorBanner, PageHeader, Table } from "@/components/admin/ui";

/** JSON 导入（PRD §09）：上传 → 逐行预览 → commit（一次性 importKey）→ 可下载结果。 */
export default function AdminImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importKey, setImportKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const doPreview = async (f: File) => {
    setBusy(true);
    setError(null);
    setPreview(null);
    setResult(null);
    setFile(f);
    try {
      const text = await f.text();
      if (text.length > 1024 * 1024) throw new Error("文件超过 1 MB 上限");
      setPreview(await adminApi.importPreview(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览失败");
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const doCommit = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const key = importKey || crypto.randomUUID();
      setImportKey(key);
      const res = await adminApi.importCommit(preview.previewId, key);
      setResult(res);
      setConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ importKey, ...result }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playtrail-import-${result.jobId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader title="JSON 导入" />
      <p className="mb-4 max-w-[80ch] text-[13px] text-ink-muted">
        UTF-8 JSON，≤1 MB，每批 ≤200 条（PRD §09）。导入只创建草稿，不自动发布；所有内容仍需人工审核。
        相同 importKey 重复提交会返回原有结果，不会重复建档。
      </p>

      <label className="inline-flex cursor-pointer items-center rounded-input border border-hairline bg-surface px-4 py-2.5 text-[14px] hover:border-ink">
        {file ? `已选择：${file.name}` : "选择导入文件（.json）"}
        <input
          type="file"
          accept=".json,application/json"
          className="sr-only"
          onChange={(e) => e.target.files?.[0] && void doPreview(e.target.files[0])}
        />
      </label>
      {busy ? <p className="mt-3 text-[13px] text-ink-muted">处理中…</p> : null}
      {error ? <div className="mt-4"><ErrorBanner error={{ message: error, status: 0, code: "", name: "e" } as never} /></div> : null}

      {preview ? (
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <span className="label-mono text-ink-muted">
              共 {preview.summary.total} 行：{preview.summary.created} 新建 · {preview.summary.duplicate} 重复 · {preview.summary.failed} 失败
            </span>
            <Button variant="primary" disabled={busy || preview.summary.created === 0} onClick={() => setConfirm(true)}>
              确认导入（生成一次性 importKey）
            </Button>
          </div>
          <Table head={["行", "名称", "结果", "说明"]}>
            {preview.rows.map((row) => (
              <tr key={row.line} className="hover:bg-surface-sunk">
                <td className="label-mono px-4 py-2.5 text-ink-muted">{row.line}</td>
                <td className="px-4 py-2.5">{row.name}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`label-mono-sm ${
                      row.status === "created" ? "text-moss" : row.status === "duplicate" ? "text-amber" : "text-signal"
                    }`}
                  >
                    {row.status === "created" ? "新建" : row.status === "duplicate" ? "重复跳过" : "失败"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-[13px] text-ink-muted">
                  {row.errorCode ? `${row.errorCode} — ` : ""}
                  {row.message ?? "—"}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}

      {result ? (
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <span className="label-mono text-ink-muted">
              导入完成（jobId {result.jobId.slice(0, 8)}…）
              {result.code === "IMPORT_KEY_REUSED" ? " · importKey 已存在，返回原有结果，未重复建档" : ""}
            </span>
            <Button onClick={download}>下载结果 JSON</Button>
            <Button
              onClick={() => {
                setPreview(null);
                setResult(null);
                setFile(null);
                setImportKey("");
              }}
            >
              导入下一批
            </Button>
          </div>
          <Table head={["行", "名称", "结果", "说明"]}>
            {result.rows.map((row) => (
              <tr key={row.line} className="hover:bg-surface-sunk">
                <td className="label-mono px-4 py-2.5 text-ink-muted">{row.line}</td>
                <td className="px-4 py-2.5">{row.name}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`label-mono-sm ${
                      row.status === "created" ? "text-moss" : row.status === "duplicate" ? "text-amber" : "text-signal"
                    }`}
                  >
                    {row.status === "created" ? "新建" : row.status === "duplicate" ? "重复跳过" : "失败"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-[13px] text-ink-muted">
                  {row.errorCode ? `${row.errorCode} — ` : ""}
                  {row.message ?? "—"}
                </td>
              </tr>
            ))}
          </Table>
          <p className="label-mono mt-3 text-ink-muted">importKey: {importKey}</p>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm}
        title="确认导入？"
        body="合法行将原子写入为草稿；失败行会逐行报告。importKey 由系统生成且一次性。"
        confirmLabel="确认导入"
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => void doCommit()}
      />
    </div>
  );
}
