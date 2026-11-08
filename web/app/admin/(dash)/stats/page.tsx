"use client";

import { useState } from "react";
import { useApi, type StatsReport } from "@/lib/api/admin";
import { ErrorBanner, Labeled, PageHeader, Table, inputCls } from "@/components/admin/ui";

/** 统计（PRD §11/§07）：按运营时区日界汇总的三类事件计数 + 详情页离站 CTR。 */
export default function AdminStatsPage() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState(() => ({
    from: new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  }));

  const { data, error, loading, reload } = useApi<StatsReport>(`/api/admin/stats?from=${query.from}&to=${query.to}`);

  const spanDays = Math.round((new Date(query.to).getTime() - new Date(query.from).getTime()) / 86400_000) + 1;
  const invalidRange = spanDays > 90 || spanDays <= 0;

  return (
    <div>
      <PageHeader title="统计" />
      <form
        className="mb-5 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ from, to });
        }}
      >
        <Labeled label="开始日期">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </Labeled>
        <Labeled label="结束日期">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </Labeled>
        <button type="submit" className="inline-flex h-10 items-center rounded-input border border-hairline bg-surface px-4 text-[14px] hover:border-ink">
          查询
        </button>
        <span className="label-mono-sm pb-3 text-ink-muted">区间最长 90 天，按运营时区（Asia/Taipei）计日</span>
      </form>

      {invalidRange ? (
        <p className="mb-4 text-[13px] text-signal">日期区间无效或超过 90 天。</p>
      ) : null}

      {loading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : error ? (
        <ErrorBanner error={error} onReload={reload} />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="游戏页浏览" value={data.totals.gameViews} />
            <Stat label="离站点击" value={data.totals.outboundClicks} />
            <Stat label="相关游戏点击" value={data.totals.relatedClicks} />
            <Stat label="详情页离站 CTR" value={`${(data.totals.ctr * 100).toFixed(1)}%`} />
          </div>

          <p className="mt-5 rounded-card border border-hairline bg-surface px-4 py-3 text-[13px] leading-relaxed text-ink-muted">
            {data.notes}
            计数是事件次数，不是人数；浏览器 DNT/GPC、广告拦截、断网或爬虫流量都会影响计数；无法代表实际游玩量或收入（PRD §11）。
          </p>

          <div className="mt-6">
            <h2 className="label-mono mb-3 text-ink-muted">按游戏</h2>
            <Table head={["游戏", "浏览", "离站点击", "CTR"]}>
              {data.byGame.map((g) => (
                <tr key={g.gameId} className="hover:bg-surface-sunk">
                  <td className="px-4 py-3">{g.name}</td>
                  <td className="label-mono px-4 py-3">{g.gameViews}</td>
                  <td className="label-mono px-4 py-3">{g.outboundClicks}</td>
                  <td className="label-mono px-4 py-3">{(g.ctr * 100).toFixed(1)}%</td>
                </tr>
              ))}
              {data.byGame.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-ink-muted">
                    该区间内没有事件数据
                  </td>
                </tr>
              ) : null}
            </Table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <p className="label-mono-sm text-ink-muted">{label}</p>
      <p className="mt-1 font-display text-[24px] font-semibold">{value}</p>
    </div>
  );
}
