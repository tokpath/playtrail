"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useApi, type AdminGameList } from "@/lib/api/admin";
import {
  AdminPagination,
  Button,
  ErrorBanner,
  PageHeader,
  StatusPill,
  Table,
  inputCls,
} from "@/components/admin/ui";

function GamesListInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [q, setQ] = useState(search.get("q") ?? "");

  const status = search.get("status") ?? "";
  const linkStatus = search.get("linkStatus") ?? "";
  const review = search.get("review") ?? "";
  const locale = search.get("locale") ?? "";
  const page = Math.max(1, Number.parseInt(search.get("page") ?? "1", 10) || 1);

  const path =
    "/api/admin/games?" +
    new URLSearchParams(
      Object.entries({ status, linkStatus, review, locale, q: q.trim(), page })
        .filter(([, v]) => v !== "")
        .map(([k, v]) => [k, String(v)]),
    ).toString();

  const { data, error, loading, reload } = useApi<AdminGameList>(path);

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(search.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== "page") params.delete("page");
    router.push(`/admin/games${params.size ? `?${params}` : ""}`);
  };

  return (
    <div>
      <PageHeader
        title="游戏"
        actions={
          <Link href="/admin/games/new">
            <Button variant="primary">新增游戏</Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", q.trim());
          }}
        >
          <label>
            <span className="label-mono-sm mb-1.5 block text-ink-muted">搜索</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名称 / slug" className={`${inputCls} w-[220px]`} />
          </label>
          <Button type="submit">搜索</Button>
        </form>
        <label>
          <span className="label-mono-sm mb-1.5 block text-ink-muted">状态</span>
          <select value={status} onChange={(e) => setParam("status", e.target.value)} className={inputCls}>
            <option value="">全部</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="unlisted">已下架</option>
          </select>
        </label>
        <label>
          <span className="label-mono-sm mb-1.5 block text-ink-muted">链接状态</span>
          <select value={linkStatus} onChange={(e) => setParam("linkStatus", e.target.value)} className={inputCls}>
            <option value="">全部</option>
            <option value="valid">有效</option>
            <option value="suspect">可疑</option>
            <option value="invalid">失效</option>
            <option value="unchecked">未检查</option>
          </select>
        </label>
        <label>
          <span className="label-mono-sm mb-1.5 block text-ink-muted">审核</span>
          <select value={review} onChange={(e) => setParam("review", e.target.value)} className={inputCls}>
            <option value="">全部</option>
            <option value="needs_review">待审核</option>
            <option value="approved">已通过</option>
          </select>
        </label>
        <label>
          <span className="label-mono-sm mb-1.5 block text-ink-muted">语言</span>
          <select value={locale} onChange={(e) => setParam("locale", e.target.value)} className={inputCls}>
            <option value="">全部</option>
            <option value="en">English</option>
            <option value="zh">简体中文</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : error ? (
        <ErrorBanner error={error} onReload={reload} />
      ) : data ? (
        <>
          <p className="label-mono mb-3 text-ink-muted">共 {data.total} 条</p>
          <Table head={["名称", "状态", "链接", "审核状态", "排序", "更新时间", ""]}>
            {data.items.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-surface-sunk">
                <td className="px-4 py-3">
                  <Link href={`/admin/games/${row.id}`} className="font-medium text-ink hover:underline">
                    {row.name}
                  </Link>
                  <span className="label-mono-sm ml-2 text-ink-muted">{row.slug}</span>
                  {row.featured ? <span className="ml-2 text-[12px] text-trail">★ 精选</span> : null}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={row.status} />
                  {row.outboundDisabled ? (
                    <span className="label-mono-sm ml-2 text-signal">CTA 关</span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={row.linkStatus} />
                </td>
                <td className="px-4 py-3">
                  {(["en", "zh"] as const).map((l) => {
                    const loc = row.locales?.[l];
                    if (!loc) return null;
                    return (
                      <span key={l} className="mr-3 inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
                        {l === "en" ? "EN" : "中"}
                        <span
                          aria-hidden="true"
                          className={`inline-block size-2 rounded-full ${
                            loc.contentReview === "approved" ? "bg-moss" : loc.contentReview === "rejected" ? "bg-signal" : "bg-amber"
                          } ${loc.live ? "ring-2 ring-moss/30" : ""}`}
                        />
                      </span>
                    );
                  })}
                </td>
                <td className="label-mono px-4 py-3 text-ink-muted">{row.editorialOrder}</td>
                <td className="label-mono px-4 py-3 text-ink-muted">
                  {new Date(row.updatedAt).toLocaleDateString("zh-CN")}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/games/${row.id}`} className="text-[13px] text-trail hover:underline">
                    编辑
                  </Link>
                </td>
              </tr>
            ))}
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-muted">
                  没有符合条件的游戏
                </td>
              </tr>
            ) : null}
          </Table>
          <AdminPagination page={data.page} totalPages={data.totalPages} onChange={(p) => setParam("page", String(p))} />
        </>
      ) : null}
    </div>
  );
}

export default function AdminGamesPage() {
  return (
    <Suspense fallback={null}>
      <GamesListInner />
    </Suspense>
  );
}
