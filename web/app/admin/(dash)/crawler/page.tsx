"use client";

import { useState } from "react";
import { adminApi, useApi, type CrawlerStatus } from "@/lib/api/admin";
import { Button, ConfirmDialog, ErrorBanner, Labeled, PageHeader, StatusPill, Table, inputCls } from "@/components/admin/ui";

/** 爬虫（PRD §22）：开关（部署层 env + DB 双层）、配额、设置、手动运行、运行记录。 */
export default function AdminCrawlerPage() {
  const { data, error, loading, reload } = useApi<CrawlerStatus>("/api/admin/crawler");
  const [confirmToggle, setConfirmToggle] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [settings, setSettings] = useState<{ dailyCap: number; minIntervalMs: number; hotAutoPublish: boolean } | null>(null);

  if (data && !settings) {
    setSettings({ dailyCap: data.dailyCap, minIntervalMs: data.minIntervalMs, hotAutoPublish: data.hotAutoPublish });
  }

  const act = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice({ text: okText, ok: true });
      reload();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "操作失败", ok: false });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-ink-muted">加载中…</p>;
  if (error) return <ErrorBanner error={error} onReload={reload} />;
  if (!data) return null;

  const effectiveOn = data.enabled && data.enabledEnv && !data.autoDisabled;

  return (
    <div>
      <PageHeader
        title="爬虫"
        actions={
          <Button
            danger={effectiveOn}
            onClick={() => setConfirmToggle(!effectiveOn)}
            disabled={busy || (!data.enabledEnv && !effectiveOn)}
          >
            {effectiveOn ? "关闭爬虫…" : "开启爬虫…"}
          </Button>
        }
      />

      {notice ? (
        <p className={`mb-4 text-[13px] ${notice.ok ? "text-moss" : "text-signal"}`}>{notice.text}</p>
      ) : null}
      {busy ? <p className="mb-4 text-[13px] text-ink-muted">处理中…</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-card border border-hairline bg-surface p-5">
          <h2 className="label-mono mb-3 text-ink-muted">运行状态</h2>
          <div className="space-y-2 text-[14px]">
            <p className="flex items-center gap-2">
              <StatusPill status={effectiveOn ? "published" : "draft"} />
              <span>{effectiveOn ? "运行中" : "已停止"}</span>
            </p>
            <p className="text-[13px] text-ink-muted">
              部署层开关 CRAWLER_ENABLED：{data.enabledEnv ? "开启" : "关闭（部署层禁用时后台无法开启）"}
              {data.enabledEnv ? ` · 数据库开关：${data.enabled ? "开启" : "关闭"}` : ""}
            </p>
            {data.autoDisabled ? (
              <p className="text-[13px] text-signal">
                已自动停用（连续终止熔断）：{data.autoDisabledReason || "连续 3 次运行被终止"}
              </p>
            ) : null}
            <p className="text-[13px] text-ink-muted">
              今日配额：{data.quotaToday} / {data.dailyCap} 次请求 · 最小间隔 {data.minIntervalMs} ms
            </p>
          </div>
        </div>

        <div className="rounded-card border border-hairline bg-surface p-5">
          <h2 className="label-mono mb-3 text-ink-muted">设置</h2>
          {settings ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Labeled label="每日请求上限">
                  <input
                    type="number"
                    min={1}
                    value={settings.dailyCap}
                    onChange={(e) => setSettings({ ...settings, dailyCap: Number(e.target.value) })}
                    className={`${inputCls} w-full`}
                  />
                </Labeled>
                <Labeled label="最小间隔（ms，≥2000）">
                  <input
                    type="number"
                    min={2000}
                    value={settings.minIntervalMs}
                    onChange={(e) => setSettings({ ...settings, minIntervalMs: Number(e.target.value) })}
                    className={`${inputCls} w-full`}
                  />
                </Labeled>
              </div>
              <label className="flex items-center gap-2 text-[14px]">
                <input
                  type="checkbox"
                  checked={settings.hotAutoPublish}
                  onChange={(e) => setSettings({ ...settings, hotAutoPublish: e.target.checked })}
                />
                热门快照自动审核发布（关闭后新批次进入人工审核）
              </label>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => adminApi.patchCrawler(settings),
                    "设置已保存。",
                  )
                }
              >
                保存设置
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6 rounded-card border border-hairline bg-surface p-5">
        <h2 className="label-mono mb-3 text-ink-muted">手动运行</h2>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["sitemap", "目录同步"],
              ["tracked", "已收录检查"],
              ["backfill", "来源补全"],
              ["hot", "热门快照"],
            ] as const
          ).map(([task, label]) => (
            <Button key={task} disabled={busy || !effectiveOn} onClick={() => void act(() => adminApi.crawlerRun(task), `${label} 任务已提交（202）。`)}>
              运行 {label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-ink-muted">
          任务在 worker 内串行执行并遵守 robots、频率与熔断规则；此处只是提交触发。
        </p>
      </div>

      <div className="mt-6">
        <h2 className="label-mono mb-3 text-ink-muted">最近运行记录</h2>
        <Table head={["任务", "开始", "结束", "请求数", "结果", "统计", "终止原因"]}>
          {data.runs.map((run) => (
            <tr key={run.id} className="hover:bg-surface-sunk">
              <td className="label-mono px-4 py-3">{run.task}</td>
              <td className="label-mono px-4 py-3 text-ink-muted">{new Date(run.startedAt).toLocaleString("zh-CN")}</td>
              <td className="label-mono px-4 py-3 text-ink-muted">
                {run.finishedAt ? new Date(run.finishedAt).toLocaleString("zh-CN") : "—"}
              </td>
              <td className="label-mono px-4 py-3">{run.requests}</td>
              <td className="px-4 py-3">
                <span
                  className={`label-mono-sm ${
                    run.outcome === "ok" ? "text-moss" : run.outcome === "running" ? "text-ink-muted" : "text-signal"
                  }`}
                >
                  {run.outcome === "ok" ? "成功" : run.outcome === "running" ? "运行中" : run.outcome === "partial" ? "部分成功" : run.outcome === "aborted" ? "已终止" : "失败"}
                </span>
              </td>
              <td className="label-mono px-4 py-3 text-ink-muted">{JSON.stringify(run.stats)}</td>
              <td className="max-w-[180px] truncate px-4 py-3 text-[13px] text-signal">{run.abortReason || "—"}</td>
            </tr>
          ))}
          {data.runs.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-ink-muted">
                还没有运行记录
              </td>
            </tr>
          ) : null}
        </Table>
      </div>

      <ConfirmDialog
        open={confirmToggle != null}
        title={confirmToggle ? "关闭爬虫？" : "开启爬虫？"}
        body={
          confirmToggle
            ? "立即生效：目录同步、已收录检查、来源补全和热门快照任务全部停止。收到平台停止要求时应 24 小时内关闭（PRD §22.1）。"
            : "开启后按配置频率自动运行；每分钟检查到期任务，遵守每日上限、最小间隔与熔断。"
        }
        confirmLabel={confirmToggle ? "确认关闭" : "确认开启"}
        busy={busy}
        onClose={() => setConfirmToggle(null)}
        onConfirm={async () => {
          const enable = confirmToggle === false;
          setConfirmToggle(null);
          await act(() => adminApi.patchCrawler({ enabled: enable }), enable ? "爬虫已开启。" : "爬虫已关闭。");
        }}
      />
    </div>
  );
}
