"use client";

import Link from "next/link";
import { adminApi, useApi } from "@/lib/api/admin";
import { PageHeader, ErrorBanner } from "@/components/admin/ui";

type Dashboard = Awaited<ReturnType<typeof adminApi.dashboard>>;

export default function AdminOverviewPage() {
  const { data, error, loading, reload } = useApi<Dashboard>("/api/admin/dashboard");

  if (loading) return <p className="text-ink-muted">加载中…</p>;
  if (error || !data) return <ErrorBanner error={error!} onReload={reload} />;

  return (
    <div>
      <PageHeader title="概览" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="草稿" value={data.counts.draft} href="/admin/games?status=draft" />
        <StatCard label="已发布" value={data.counts.published} href="/admin/games?status=published" />
        <StatCard label="已下架" value={data.counts.unlisted} href="/admin/games?status=unlisted" />
        <StatCard label="待审核语言" value={data.counts.pendingReview} href="/admin/games?review=needs_review" />
        <StatCard label="可疑链接" value={data.counts.suspectLinks} href="/admin/games?linkStatus=suspect" />
        <StatCard label="变更待复核" value={data.counts.sourceChangesPending} href="/admin/changes" />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-card border border-hairline bg-surface p-5">
          <h2 className="label-mono text-ink-muted">已上线语言</h2>
          <p className="mt-2 text-[15px]">
            {data.liveLocales.length > 0 ? data.liveLocales.join("、") : "无（均未达 10 款门槛）"}
          </p>
        </div>
        <div className="rounded-card border border-hairline bg-surface p-5">
          <h2 className="label-mono text-ink-muted">热门快照</h2>
          {data.hot ? (
            <p className="mt-2 text-[15px]">
              最近批次采集于 {new Date(data.hot.sourceFetchedAt).toLocaleString("zh-CN")}
              {data.hot.stale ? " · 已超过 48 小时" : ""}
            </p>
          ) : (
            <p className="mt-2 text-[15px] text-ink-muted">暂无快照</p>
          )}
        </div>
        <div className="rounded-card border border-hairline bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="label-mono text-ink-muted">爬虫</h2>
            <Link href="/admin/crawler" className="text-[12px] text-trail hover:underline">
              详情 →
            </Link>
          </div>
          <CrawlerSummary crawler={data.crawler} />
        </div>
      </div>
    </div>
  );
}

function CrawlerSummary({ crawler }: { crawler: Awaited<ReturnType<typeof adminApi.dashboard>>["crawler"] }) {
  const on = crawler.enabled && crawler.enabledEnv && !crawler.autoDisabled;
  const lastByTask: Record<string, { startedAt: string; outcome: string }> = {};
  for (const r of crawler.runs ?? []) {
    if (!lastByTask[r.task] || lastByTask[r.task].startedAt < r.startedAt) lastByTask[r.task] = r;
  }
  const outcomeZh: Record<string, string> = { ok: "成功", running: "运行中", partial: "部分成功", aborted: "已终止", failed: "失败" };
  return (
    <div className="mt-2 space-y-2 text-[14px]">
      <p>
        {on ? "运行中" : "已停止"}
        <span className="text-[13px] text-ink-muted">
          {" "}
          · 部署层开关{crawler.enabledEnv ? "开启" : "关闭"} · 今日配额 {crawler.quotaToday} / {crawler.dailyCap} 次
        </span>
      </p>
      {crawler.autoDisabled ? (
        <p className="text-[13px] text-signal">已自动停用：{crawler.autoDisabledReason || "连续运行被终止"}</p>
      ) : null}
      {Object.keys(lastByTask).length > 0 ? (
        <ul className="space-y-1 text-[13px] text-ink-muted">
          {Object.entries(lastByTask).map(([task, r]) => (
            <li key={task}>
              <span className="label-mono-sm">{task}</span> · {new Date(r.startedAt).toLocaleString("zh-CN")} · {outcomeZh[r.outcome] ?? r.outcome}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-muted">还没有运行记录</p>
      )}
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <div className="rounded-card border border-hairline bg-surface p-4 transition-colors hover:border-ink">
      <p className="label-mono-sm text-ink-muted">{label}</p>
      <p className="mt-1 font-display text-[26px] font-semibold">{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
