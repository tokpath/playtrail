"use client";

import { useState } from "react";
import { adminApi, useApi, type AdminHotSnapshot } from "@/lib/api/admin";
import { Button, ConfirmDialog, ErrorBanner, Labeled, PageHeader, StatusPill, inputCls } from "@/components/admin/ui";

/** 热门快照管理（PRD §06/§22.9）：列表、审核、停用、手工创建。 */
export default function AdminHotPage() {
  const list = useApi<{ items: AdminHotSnapshot[] }>("/api/admin/hot-snapshots");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<AdminHotSnapshot | null>(null);
  const [creating, setCreating] = useState(false);

  const act = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice({ text: okText, ok: true });
      list.reload();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "操作失败", ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="热门快照"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            手工创建
          </Button>
        }
      />
      <p className="mb-4 max-w-[80ch] text-[13px] text-ink-muted">
        快照记录 CrazyGames /hot 页某时刻的展示顺序（过去 24 小时热度上升），只保留能映射到本站已发布游戏的条目，原始 position 不重排。
        超过 48 小时未更新的快照在公开页标注「历史快照」，首页不再展示。
      </p>
      {notice ? (
        <p className={`mb-4 text-[13px] ${notice.ok ? "text-moss" : "text-signal"}`}>{notice.text}</p>
      ) : null}

      {list.loading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : list.error ? (
        <ErrorBanner error={list.error} onReload={list.reload} />
      ) : list.data ? (
        <div className="space-y-4">
          {list.data.items.map((snap) => (
            <div key={snap.id} className="rounded-card border border-hairline bg-surface p-5">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill status={snap.reviewState} />
                <span className="label-mono-sm text-ink-muted">
                  采集于 {new Date(snap.sourceFetchedAt).toLocaleString("zh-CN")} · 地区 {snap.observedRegion}
                </span>
                {snap.active ? <span className="label-mono-sm text-moss">启用中</span> : <span className="label-mono-sm text-ink-muted">已停用</span>}
                <span className="label-mono-sm text-ink-muted">
                  {snap.items.length} 项 · 创建者 {snap.createdBy.slice(0, 8)}
                </span>
                <span className="ml-auto flex gap-2">
                  {snap.reviewState !== "approved" ? (
                    <Button disabled={busy} onClick={() => void act(() => adminApi.hotReview(snap.id, "approved"), "已审核通过。")}>
                      审核通过
                    </Button>
                  ) : null}
                  {snap.reviewState !== "rejected" ? (
                    <Button danger disabled={busy} onClick={() => void act(() => adminApi.hotReview(snap.id, "rejected"), "已拒绝。")}>
                      拒绝
                    </Button>
                  ) : null}
                  {snap.active ? (
                    <Button danger disabled={busy} onClick={() => setConfirmDeactivate(snap)}>
                      停用…
                    </Button>
                  ) : null}
                </span>
              </div>
              <p className="mt-2 text-[13px] text-ink-muted">{snap.definition}</p>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {snap.items.map((item) => (
                  <span key={item.position} className="label-mono-sm text-ink-muted">
                    #{item.position} {item.sourceSlug}
                    {item.gameId ? "" : "（未映射）"}
                  </span>
                ))}
              </p>
            </div>
          ))}
          {list.data.items.length === 0 ? <p className="text-ink-muted">还没有快照批次。</p> : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDeactivate != null}
        title="停用该快照批次？"
        body="停用后公开热门页立即不再展示该批次；首页热门模块随之隐藏（48 小时规则不变）。"
        confirmLabel="确认停用"
        busy={busy}
        onClose={() => setConfirmDeactivate(null)}
        onConfirm={async () => {
          const id = confirmDeactivate?.id;
          setConfirmDeactivate(null);
          if (id) await act(() => adminApi.hotDeactivate(id), "已停用。");
        }}
      />

      {creating ? <CreateSnapshotDialog onClose={() => setCreating(false)} onDone={() => { setCreating(false); list.reload(); }} /> : null}
    </div>
  );
}

function CreateSnapshotDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    sourceUrl: "https://www.crazygames.com/hot",
    sourceFetchedAt: new Date().toISOString().slice(0, 16),
    observedRegion: "TW",
    definition: "过去 24 小时热度上升（人工采集）",
    cacheNote: "",
    items: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const items = form.items
        .split("\n")
        .map((line, i) => ({ position: i + 1, sourceSlug: line.trim() }))
        .filter((x) => x.sourceSlug);
      await adminApi.hotCreate({
        sourceUrl: form.sourceUrl,
        sourceFetchedAt: new Date(form.sourceFetchedAt).toISOString(),
        observedRegion: form.observedRegion,
        definition: form.definition,
        cacheNote: form.cacheNote,
        items,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4" onClick={onClose}>
      <form
        className="w-full max-w-[560px] rounded-card border border-hairline bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="font-display text-[17px] font-semibold">手工创建快照</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Labeled label="来源 URL">
            <input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} className={`${inputCls} w-full font-mono`} />
          </Labeled>
          <Labeled label="采集时间">
            <input type="datetime-local" value={form.sourceFetchedAt} onChange={(e) => setForm({ ...form, sourceFetchedAt: e.target.value })} className={`${inputCls} w-full`} />
          </Labeled>
          <Labeled label="采集地区">
            <input value={form.observedRegion} onChange={(e) => setForm({ ...form, observedRegion: e.target.value })} className={`${inputCls} w-full`} />
          </Labeled>
          <Labeled label="缓存备注（可选）">
            <input value={form.cacheNote} onChange={(e) => setForm({ ...form, cacheNote: e.target.value })} className={`${inputCls} w-full`} />
          </Labeled>
        </div>
        <Labeled label="榜单定义">
          <input value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} className={`${inputCls} w-full`} />
        </Labeled>
        <Labeled label="条目（每行一个 CrazyGames slug，按页面顺序，最多 20 行）">
          <textarea
            rows={5}
            value={form.items}
            onChange={(e) => setForm({ ...form, items: e.target.value })}
            className="w-full rounded-input border border-hairline bg-paper p-3 font-mono text-[13px]"
          />
        </Labeled>
        {error ? <p className="mt-2 text-[13px] text-signal">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "创建中…" : "创建"}
          </Button>
        </div>
      </form>
    </div>
  );
}
