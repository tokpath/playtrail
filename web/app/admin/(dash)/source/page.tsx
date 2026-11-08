"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi, useApi } from "@/lib/api/admin";
import {
  AdminPagination,
  Button,
  ConfirmDialog,
  ErrorBanner,
  Labeled,
  PageHeader,
  Table,
  inputCls,
} from "@/components/admin/ui";

/** 来源目录（PRD §22.5）：筛选、详情抽屉（含 amber 版权提示）、收录为草稿。 */
export default function AdminSourcePage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [mobile, setMobile] = useState("");
  const [collected, setCollected] = useState("");
  const [detail, setDetail] = useState("yes");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmCollect, setConfirmCollect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const listPath =
    "/api/admin/source-games?" +
    new URLSearchParams(
      Object.entries({ q: q.trim(), category, mobile, collected, detail, page: String(page) })
        .filter(([, v]) => v !== "")
        .map(([k, v]) => [k, String(v)]),
    ).toString();
  const list = useApi<{ items: import("@/lib/api/admin").SourceGameRow[]; total: number; page: number; totalPages: number }>(listPath);
  const detail_ = useApi<Awaited<ReturnType<typeof adminApi.sourceGame>> | null>(openId ? `/api/admin/source-games/${openId}` : null);

  const collect = async () => {
    if (!openId) return;
    setBusy(true);
    setNotice(null);
    try {
      const game = await adminApi.collect(openId);
      setOpenId(null);
      router.push(`/admin/games/${game.id}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "收录失败");
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="来源目录" />
      <p className="mb-4 max-w-[80ch] text-[13px] text-ink-muted">
        来源目录由爬虫同步（PRD §22.5），不直接公开。收录为草稿后，字段按 §22.6 预填，各语言内容待编辑补写并审核。
      </p>
      {notice ? <p className="mb-4 text-[13px] text-signal">{notice}</p> : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            void listPath;
            list.reload();
          }}
        >
          <label>
            <span className="label-mono-sm mb-1.5 block text-ink-muted">搜索</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名称 / slug" className={`${inputCls} w-[220px]`} />
          </label>
          <Button type="submit">搜索</Button>
        </form>
        <Labeled label="分类">
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="分类 slug" className={`${inputCls} w-[140px]`} />
        </Labeled>
        <Labeled label="移动端">
          <select value={mobile} onChange={(e) => setMobile(e.target.value)} className={inputCls}>
            <option value="">全部</option>
            <option value="true">支持移动端</option>
            <option value="false">不支持</option>
          </select>
        </Labeled>
        <Labeled label="已收录">
          <select value={collected} onChange={(e) => setCollected(e.target.value)} className={inputCls}>
            <option value="">全部</option>
            <option value="true">已收录</option>
            <option value="false">未收录</option>
          </select>
        </Labeled>
        <Labeled label="详情">
          <select value={detail} onChange={(e) => setDetail(e.target.value)} className={inputCls}>
            <option value="">全部</option>
            <option value="yes">已抓详情</option>
            <option value="no">未抓详情</option>
          </select>
        </Labeled>
      </div>

      {list.loading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : list.error ? (
        <ErrorBanner error={list.error} onReload={list.reload} />
      ) : list.data ? (
        <>
          <p className="label-mono mb-3 text-ink-muted">共 {list.data.total} 条来源记录</p>
          <Table head={["名称", "分类", "开发商", "移动端", "收录状态", "详情", "最近抓取", ""]}>
            {list.data.items.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-surface-sunk">
                <td className="px-4 py-3">
                  {row.name ? (
                    <>
                      <button type="button" className="font-medium text-ink hover:underline" onClick={() => setOpenId(row.id)}>
                        {row.name}
                      </button>
                      <span className="label-mono-sm ml-2 text-ink-muted">{row.slug}</span>
                    </>
                  ) : (
                    <>
                      <button type="button" className="label-mono text-ink hover:underline" onClick={() => setOpenId(row.id)}>
                        {row.slug}
                      </button>
                      <span className="label-mono-sm ml-2 rounded-full border border-hairline px-2 py-0.5 text-ink-muted">未抓取详情</span>
                    </>
                  )}
                </td>
                <td className="label-mono px-4 py-3 text-ink-muted">{row.categorySlug || "—"}</td>
                <td className="px-4 py-3 text-ink-muted">{row.developer || "—"}</td>
                <td className="px-4 py-3 text-ink-muted">{row.mobile ? "✓" : "—"}</td>
                <td className="px-4 py-3">
                  {row.collected ? (
                    <span className="label-mono-sm text-moss">已收录</span>
                  ) : (
                    <span className="label-mono-sm text-ink-muted">未收录</span>
                  )}
                </td>
                <td className="px-4 py-3 text-ink-muted">{row.hasDetail ? "✓" : "—"}</td>
                <td className="label-mono px-4 py-3 text-ink-muted">
                  {row.lastFetchResult ? `${row.lastFetchResult}` : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" className="text-[13px] text-trail hover:underline" onClick={() => setOpenId(row.id)}>
                    详情
                  </button>
                </td>
              </tr>
            ))}
          </Table>
          <AdminPagination page={list.data.page} totalPages={list.data.totalPages} onChange={setPage} />
        </>
      ) : null}

      {/* Detail drawer */}
      {openId ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={() => setOpenId(null)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="来源详情"
            className="h-dvh w-[560px] max-w-[92vw] overflow-y-auto border-l border-hairline bg-paper p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {detail_.loading || !detail_.data ? (
              <p className="text-ink-muted">加载中…</p>
            ) : (
              <SourceDrawerContent row={detail_.data} />
            )}
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-hairline pt-4">
              <Button onClick={() => setOpenId(null)}>关闭</Button>
              {detail_.data && !detail_.data.collected ? (
                <Button variant="primary" disabled={busy} onClick={() => setConfirmCollect(true)}>
                  收录为草稿
                </Button>
              ) : (
                <span className="label-mono-sm text-moss">已收录</span>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmCollect}
        title="收录为草稿？"
        body="将按 §22.6 映射预填字段创建草稿：status=draft，各语言 contentReview=pending，需要编辑补写原创简介后审核发布。"
        confirmLabel="收录为草稿"
        busy={busy}
        onClose={() => setConfirmCollect(false)}
        onConfirm={() => void collect()}
      />
    </div>
  );
}

/** Reference fields are copyrighted CrazyGames content: reference only. */
function SourceDrawerContent({ row }: { row: Awaited<ReturnType<typeof adminApi.sourceGame>> }) {
  const ref = (row.reference ?? {}) as Record<string, unknown>;
  const deviceFlags = (row.deviceFlags ?? {}) as Record<string, boolean>;

  /** A2: booleans as 是/否, missing values as —. */
  const fmt = (v: unknown): string => {
    if (v == null || v === "") return "—";
    if (typeof v === "boolean") return v ? "是" : "否";
    return String(v);
  };
  const fields: [string, unknown][] = [
    ["来源 ID", row.sourceId],
    ["分类", row.categorySlug],
    ["开发商", row.developer],
    ["标签", (row.tags ?? []).join("、")],
    ["多玩家", row.isMultiplayer],
    ["设备标记", Object.entries(deviceFlags).filter(([, v]) => v).map(([k]) => k).join("、")],
    ["收录时间", row.addedOn],
    ["最后重大更新", row.lastSignificantUpdatedOn],
    ["来源状态", row.sourceStatus],
    ["评分", row.rating],
    ["赞 / 踩", row.upvotes != null || row.downvotes != null ? `${row.upvotes ?? "—"} / ${row.downvotes ?? "—"}` : null],
    ["最近抓取", row.lastFetchedAt ? new Date(row.lastFetchedAt).toLocaleString("zh-CN") : null],
    ["抓取结果", row.lastFetchResult],
    ["连续失败天数", row.consecutiveFailDays],
  ];
  const refKeys: [string, string][] = [
    ["descriptionFirst", "简介（前段）"],
    ["descriptionRest", "简介（后段）"],
    ["controls", "操作说明"],
    ["faq", "FAQ"],
    ["cover", "封面路径"],
    ["videoUrl", "视频路径"],
  ];

  return (
    <div>
      <h2 className="font-display text-[20px] font-semibold">{row.name || row.slug}</h2>
      <p className="label-mono-sm mt-1 text-ink-muted">{row.slug}</p>

      <div className="mt-5 space-y-2">
        {fields.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[130px_1fr] gap-3 border-b border-hairline pb-2">
            <span className="label-mono-sm pt-0.5 text-ink-muted">{k}</span>
            <span className="min-w-0 break-words">{fmt(v)}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-card border-l-[3px] border-amber bg-amber/[0.07] px-4 py-3">
        <p className="label-mono text-amber">以下内容版权属于原作者</p>
        <p className="mt-1 text-[13px] text-ink">
          仅供核对事实，不得复制或翻译后发布。公开内容必须由编辑原创撰写。
        </p>
        <dl className="mt-3 space-y-2">
          {refKeys.map(([key, label]) => (
            <div key={key} className="grid grid-cols-[130px_1fr] gap-3">
              <dt className="label-mono-sm pt-0.5 text-ink-muted">{label}</dt>
              <dd className="min-w-0 break-words text-[13px] text-ink-muted">
                {ref[key] == null || ref[key] === "" ? "—" : String(ref[key]).slice(0, 600)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
