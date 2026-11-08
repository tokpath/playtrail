"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  adminApi,
  AdminApiError,
  cgCoverUrl,
  mediaUrl,
  useApi,
  type AdminGame,
  type GateReport,
  type MediaAsset,
  type GameDetail,
} from "@/lib/api/admin";
import {
  Button,
  ConfirmDialog,
  ErrorBanner,
  FieldError,
  Labeled,
  PageHeader,
  ReviewDot,
  StatusPill,
  inputCls,
} from "@/components/admin/ui";

type FE = Record<string, string>;
const LOCALES = ["en", "zh"] as const;
type Locale = (typeof LOCALES)[number];

export default function AdminGameEditPage() {
  const { id } = useParams<{ id: string }>();

  const [game, setGame] = useState<AdminGame | null>(null);
  const [gates, setGates] = useState<GateReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Draft state: shared fields + per-locale content for the active tab.
  const [shared, setShared] = useState({
    name: "",
    developer: "",
    primaryCategory: "",
    tags: [] as string[],
    deviceSupport: "unknown" as AdminGame["deviceSupport"],
    deviceEvidenceUrl: "",
    deviceCheckedAt: "",
    sourceUrl: "",
    sourceFetchedAt: "",
    coverAssetId: "" as string | null,
    coverSourcePath: "",
    screenshotAssetIds: [] as string[],
    usePlaceholder: true,
    materialReview: "placeholder" as AdminGame["materialReview"],
    featured: false,
    editorialOrder: 1000,
  });
  const [localeDraft, setLocaleDraft] = useState<Record<Locale, { alias: string; summary: string; description: string; controls: string; coverAlt: string }>>(
    {
      en: { alias: "", summary: "", description: "", controls: "", coverAlt: "" },
      zh: { alias: "", summary: "", description: "", controls: "", coverAlt: "" },
    },
  );
  const [activeLocale, setActiveLocale] = useState<Locale>("en");
  const [fieldErrors, setFieldErrors] = useState<FE>({});
  const [notice, setNotice] = useState<{ text: string; ok: boolean; requestId?: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);

  // Dialog state: one generic confirm + dedicated publish dialog.
  const [confirm, setConfirm] = useState<
    | { kind: "unlist" }
    | { kind: "outbound"; enabled: boolean }
    | { kind: "publish"; locales: Locale[] }
    | null
  >(null);
  const [preview, setPreview] = useState<GameDetail | null>(null);
  // Assets known to the client: uploaded this session, or fetched from
  // GET /admin/media/{id} on load so earlier sessions' assets render as
  // real thumbnails (A5).
  const [assets, setAssets] = useState<Record<string, MediaAsset>>({});

  const categories = useApi<{ items: { slug: string; names: Record<string, string> }[] }>("/api/admin/categories");
  const tags = useApi<{ items: { slug: string; names: Record<string, string>; active: boolean }[] }>("/api/admin/tags");

  const load = useCallback(async () => {
    try {
      const g = await adminApi.getGame(id);
      setLoadError(null);
      setGame(g);
      setShared({
        name: g.name,
        developer: g.developer,
        primaryCategory: g.primaryCategory ?? "",
        tags: g.tags,
        deviceSupport: g.deviceSupport,
        deviceEvidenceUrl: g.deviceEvidenceUrl,
        deviceCheckedAt: g.deviceCheckedAt ? g.deviceCheckedAt.slice(0, 16) : "",
        sourceUrl: g.sourceUrl,
        sourceFetchedAt: g.sourceFetchedAt.slice(0, 16),
        coverAssetId: g.coverAssetId,
        coverSourcePath: g.coverSourcePath,
        screenshotAssetIds: g.screenshotAssetIds,
        usePlaceholder: g.usePlaceholder,
        materialReview: g.materialReview,
        featured: g.featured,
        editorialOrder: g.editorialOrder,
      });
      setLocaleDraft({
        en: localeState(g, "en"),
        zh: localeState(g, "zh"),
      });
      setGates(await adminApi.gates(id));
      // A5: hydrate asset metadata for ids from earlier sessions so the media
      // section shows real thumbnails instead of neutral boxes.
      const ids = [...new Set([g.coverAssetId, ...(g.screenshotAssetIds ?? [])].filter(Boolean))] as string[];
      await Promise.all(
        ids.map(async (mid) => {
          try {
            const a = await adminApi.getMedia(mid);
            setAssets((m) => ({ ...m, [mid]: a }));
          } catch {
            // Asset metadata unavailable — keep the neutral box fallback.
          }
        }),
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "加载失败");
    }
  }, [id]);

  useEffect(() => {
    // Defer past the effect body so the fetch's state updates stay async.
    void Promise.resolve().then(() => load());
  }, [load]);

  const patchBody = (locales?: Locale[]) => {
    const body: Record<string, unknown> = { revisionVersion: game?.revisionVersion };
    Object.assign(body, {
      name: shared.name.trim(),
      developer: shared.developer.trim(),
      primaryCategory: shared.primaryCategory || undefined,
      tags: shared.tags,
      deviceSupport: shared.deviceSupport,
      deviceEvidenceUrl: shared.deviceEvidenceUrl.trim(),
      deviceCheckedAt: shared.deviceCheckedAt ? new Date(shared.deviceCheckedAt).toISOString() : undefined,
      sourceUrl: shared.sourceUrl.trim(),
      sourceFetchedAt: shared.sourceFetchedAt ? new Date(shared.sourceFetchedAt).toISOString() : undefined,
      coverAssetId: shared.coverAssetId || null,
      coverSourcePath: shared.coverSourcePath.trim(),
      screenshotAssetIds: shared.screenshotAssetIds,
      usePlaceholder: shared.usePlaceholder,
      materialReview: shared.materialReview,
      featured: shared.featured,
      editorialOrder: shared.editorialOrder,
    });
    for (const l of locales ?? LOCALES) {
      const d = localeDraft[l];
      const mediaAlt: Record<string, string> = {};
      if (shared.coverAssetId && d.coverAlt.trim()) mediaAlt[shared.coverAssetId] = d.coverAlt.trim();
      body.locales = { ...(body.locales as Record<string, unknown>), [l]: { ...d, mediaAlt } };
    }
    return body;
  };

  const save = async (localeTabs: Locale[] = [activeLocale], quiet = false) => {
    if (!game) return false;
    setBusy(true);
    setNotice(null);
    setFieldErrors({});
    try {
      const g = await adminApi.patchGame(game.id, patchBody(localeTabs));
      setGame(g);
      setShared((s) => ({ ...s, ...sharedFrom(g) }));
      setLocaleDraft({ en: localeState(g, "en"), zh: localeState(g, "zh") });
      setGates(await adminApi.gates(game.id));
      if (!quiet) setNotice({ text: "已保存。", ok: true });
      return true;
    } catch (e) {
      if (e instanceof AdminApiError) {
        if (e.status === 409) setConflict(true);
        else {
          setNotice({ text: e.message, ok: false, requestId: e.requestId });
          setFieldErrors(e.fieldErrors ?? {});
        }
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<AdminGame>) => {
    setBusy(true);
    setNotice(null);
    try {
      const g = await fn();
      setGame(g);
      setShared((s) => ({ ...s, ...sharedFrom(g) }));
      setLocaleDraft({ en: localeState(g, "en"), zh: localeState(g, "zh") });
      setGates(await adminApi.gates(game!.id));
      return true;
    } catch (e) {
      if (e instanceof AdminApiError) {
        if (e.status === 409) setConflict(true);
        else setNotice({ text: e.message, ok: false, requestId: e.requestId });
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File, target: "cover" | "screenshot") => {
    setBusy(true);
    setNotice(null);
    try {
      const asset = await adminApi.uploadMedia(file);
      setAssets((m) => ({ ...m, [asset.id]: asset }));
      if (target === "cover") {
        setShared((s) => ({ ...s, coverAssetId: asset.id, usePlaceholder: false }));
      } else {
        setShared((s) => ({
          ...s,
          screenshotAssetIds: s.screenshotAssetIds.length >= 5 ? s.screenshotAssetIds : [...s.screenshotAssetIds, asset.id],
        }));
      }
      setNotice({ text: "素材已上传（尚未保存），记得点击保存。", ok: true });
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "上传失败", ok: false });
    } finally {
      setBusy(false);
    }
  };

  const previewOfCover = (assetId: string) => {
    const asset = assets[assetId];
    if (!asset) return "";
    const best = [...asset.variants].sort((a, b) => b.width - a.width)[0];
    return best ? mediaUrl(best.path) : "";
  };

  if (loadError) {
    return (
      <div>
        <PageHeader title="游戏编辑" />
        <ErrorBanner error={{ message: loadError, status: 0, code: "", name: "x" } as never} />
      </div>
    );
  }
  if (!game) return <p className="text-ink-muted">加载中…</p>;

  return (
    <div>
      <PageHeader
        title={game.name || "游戏编辑"}
        actions={
          <Link href="/admin/games" className="text-[13px] text-ink-muted hover:underline">
            ← 返回列表
          </Link>
        }
      />

      {/* Status bar */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-hairline bg-surface px-4 py-3">
        <StatusPill status={game.status} />
        <StatusPill status={game.linkStatus} />
        <span className="label-mono text-ink-muted">版本 {game.revisionVersion}</span>
        {game.hasPendingChanges ? <span className="text-[13px] text-amber">有待发布修改</span> : null}
        {game.outboundDisabled ? <span className="text-[13px] text-signal">CTA 已关闭</span> : null}
        <span className="label-mono-sm text-ink-muted">{game.slug}</span>
      </div>

      {notice ? (
        <p className={`mb-4 text-[13px] ${notice.ok ? "text-moss" : "text-signal"}`}>
          {notice.text}
          {notice.requestId ? <span className="ml-1 font-mono text-[11px] opacity-70">（requestId: {notice.requestId}）</span> : null}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {/* 基本信息 */}
          <Section title="基本信息">
            <Labeled label="游戏名" error={fieldErrors.name} hint="官方英文名，1–150 字符">
              <input value={shared.name} onChange={(e) => setShared({ ...shared, name: e.target.value })} className={`${inputCls} w-full`} />
            </Labeled>
            <Labeled label="开发商" error={fieldErrors.developer}>
              <input value={shared.developer} onChange={(e) => setShared({ ...shared, developer: e.target.value })} className={`${inputCls} w-full`} />
            </Labeled>
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label="外链 URL" hint="首次发布后不可修改">
                <input value={game.externalUrl} disabled className={`${inputCls} w-full font-mono opacity-60`} />
              </Labeled>
              <Labeled label="slug" hint="首次发布后不可修改">
                <input value={game.slug} disabled className={`${inputCls} w-full font-mono opacity-60`} />
              </Labeled>
            </div>
          </Section>

          {/* 分类与标签 */}
          <Section title="分类与标签">
            <Labeled label="主类别" error={fieldErrors.primaryCategory}>
              <select
                value={shared.primaryCategory}
                onChange={(e) => setShared({ ...shared, primaryCategory: e.target.value })}
                className={`${inputCls} w-full`}
              >
                <option value="">（未选择）</option>
                {(categories.data?.items ?? []).map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.names.zh ?? c.slug}（{c.slug}）
                  </option>
                ))}
              </select>
            </Labeled>
            <div>
              <span className="label-mono-sm mb-1.5 block text-ink-muted">标签（最多 8 个，按顺序显示前 3 个）</span>
              <div className="flex flex-wrap gap-2">
                {(tags.data?.items ?? [])
                  .filter((t) => t.active)
                  .map((t) => {
                    const selected = shared.tags.includes(t.slug);
                    return (
                      <button
                        key={t.slug}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setShared((s) => ({
                            ...s,
                            tags: selected ? s.tags.filter((x) => x !== t.slug) : s.tags.length >= 8 ? s.tags : [...s.tags, t.slug],
                          }))
                        }
                        className={`inline-flex h-8 items-center rounded-full px-3 text-[13px] ${
                          selected ? "bg-ink text-paper" : "border border-hairline bg-surface text-ink hover:border-ink"
                        }`}
                      >
                        {t.names.zh ?? t.slug}
                      </button>
                    );
                  })}
              </div>
              <FieldError error={fieldErrors.tags} />
            </div>
          </Section>

          {/* 设备与来源 */}
          <Section title="设备与来源">
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label="设备支持">
                <select
                  value={shared.deviceSupport}
                  onChange={(e) => setShared({ ...shared, deviceSupport: e.target.value as AdminGame["deviceSupport"] })}
                  className={`${inputCls} w-full`}
                >
                  <option value="unknown">未确认</option>
                  <option value="desktop">桌面</option>
                  <option value="mobile">移动端</option>
                  <option value="both">桌面和移动端</option>
                </select>
              </Labeled>
              <Labeled label="设备证据 URL" hint="deviceSupport ≠ unknown 时必填">
                <input
                  value={shared.deviceEvidenceUrl}
                  onChange={(e) => setShared({ ...shared, deviceEvidenceUrl: e.target.value })}
                  className={`${inputCls} w-full font-mono`}
                />
              </Labeled>
              <Labeled label="设备核实时间">
                <input
                  type="datetime-local"
                  value={shared.deviceCheckedAt}
                  onChange={(e) => setShared({ ...shared, deviceCheckedAt: e.target.value })}
                  className={`${inputCls} w-full`}
                />
              </Labeled>
              <Labeled label="来源核实时间" error={fieldErrors.sourceFetchedAt}>
                <input
                  type="datetime-local"
                  value={shared.sourceFetchedAt}
                  onChange={(e) => setShared({ ...shared, sourceFetchedAt: e.target.value })}
                  className={`${inputCls} w-full`}
                />
              </Labeled>
            </div>
            <Labeled label="来源 URL" hint="https 公开证据页；来源变更需重新审核">
              <input value={shared.sourceUrl} onChange={(e) => setShared({ ...shared, sourceUrl: e.target.value })} className={`${inputCls} w-full font-mono`} />
            </Labeled>
          </Section>

          {/* 素材 */}
          <Section title="素材">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="label-mono-sm mb-1.5 block text-ink-muted">封面</span>
                <div className="aspect-video overflow-hidden rounded-cover border border-hairline bg-surface-sunk">
                  {shared.coverAssetId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewOfCover(shared.coverAssetId)} alt="封面预览" className="h-full w-full object-cover" />
                  ) : shared.coverSourcePath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cgCoverUrl(shared.coverSourcePath)} alt="封面预览" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[13px] text-ink-muted">
                      {shared.usePlaceholder ? "使用通用占位视觉" : "未设置封面"}
                    </div>
                  )}
                </div>
                <label className="mt-2 inline-flex cursor-pointer items-center text-[13px] text-trail hover:underline">
                  上传封面（JPEG/PNG/WebP ≤2MB）
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0], "cover")}
                  />
                </label>
              </div>
              <div className="space-y-4">
                <Labeled label="CrazyGames 封面路径（coverSourcePath）" hint="仅由来源目录素材派生公开封面；留空清除">
                  <input
                    value={shared.coverSourcePath}
                    onChange={(e) => setShared({ ...shared, coverSourcePath: e.target.value })}
                    className={`${inputCls} w-full font-mono`}
                    placeholder="例：bloxdhop-io_16x9/20261027023447/bloxdhop-io_16x9-cover.png"
                  />
                </Labeled>
                <label className="flex items-center gap-2 text-[14px]">
                  <input
                    type="checkbox"
                    checked={shared.usePlaceholder}
                    onChange={(e) => setShared({ ...shared, usePlaceholder: e.target.checked })}
                  />
                  显式使用通用占位视觉（无授权素材时）
                </label>
                <Labeled label="素材审核状态">
                  <select
                    value={shared.materialReview}
                    onChange={(e) => setShared({ ...shared, materialReview: e.target.value as AdminGame["materialReview"] })}
                    className={`${inputCls} w-full`}
                  >
                    <option value="placeholder">占位</option>
                    <option value="pending">待审核</option>
                    <option value="approved">已通过</option>
                    <option value="rejected">已拒绝</option>
                  </select>
                </Labeled>
              </div>
            </div>
            <div>
              <span className="label-mono-sm mb-1.5 block text-ink-muted">截图（最多 5 张）</span>
              <div className="flex flex-wrap gap-3">
                {shared.screenshotAssetIds.map((sid) => (
                  <div key={sid} className="relative">
                    <div className="h-[72px] w-[128px] overflow-hidden rounded-[8px] border border-hairline">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previewOfCover(sid)} alt="截图" className="h-full w-full object-cover" />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShared((s) => ({ ...s, screenshotAssetIds: s.screenshotAssetIds.filter((x) => x !== sid) }))}
                      className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border border-hairline bg-surface text-[12px]"
                      aria-label="移除截图"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {shared.screenshotAssetIds.length < 5 ? (
                  <label className="flex h-[72px] w-[128px] cursor-pointer items-center justify-center rounded-[8px] border border-dashed border-hairline text-[12px] text-ink-muted hover:border-ink">
                    上传截图
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0], "screenshot")}
                    />
                  </label>
                ) : null}
              </div>
            </div>
          </Section>

          {/* 编排 */}
          <Section title="编排">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center gap-2 pt-6 text-[14px]">
                <input type="checkbox" checked={shared.featured} onChange={(e) => setShared({ ...shared, featured: e.target.checked })} />
                编辑精选（首页「今日路线」）
              </label>
              <Labeled label="编辑排序（非负整数，越小越靠前）" error={fieldErrors.editorialOrder}>
                <input
                  type="number"
                  min={0}
                  value={shared.editorialOrder}
                  onChange={(e) => setShared({ ...shared, editorialOrder: Number(e.target.value) })}
                  className={`${inputCls} w-full`}
                />
              </Labeled>
            </div>
          </Section>

          {/* 语言内容 */}
          <Section title="语言内容">
            <div className="mb-4 flex gap-1 border-b border-hairline">
              {LOCALES.map((l) => {
                const loc = game.locales[l];
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setActiveLocale(l)}
                    aria-pressed={activeLocale === l}
                    className={`-mb-px flex h-10 items-center gap-2 rounded-t-[10px] border-x border-t px-4 text-[14px] ${
                      activeLocale === l ? "border-hairline bg-surface font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink"
                    }`}
                  >
                    {l === "en" ? "English" : "简体中文"}
                    <ReviewDot state={loc?.contentReview ?? "pending"} />
                    {loc?.live ? <span className="label-mono-sm text-moss">已上线</span> : null}
                  </button>
                );
              })}
            </div>
            {LOCALES.map((l) =>
              l === activeLocale ? (
                <div key={l} className="space-y-4">
                  <p className="text-[13px] text-ink-muted">
                    审核状态：
                    <span className="ml-1 inline-flex items-center gap-1.5">
                      <ReviewDot state={game.locales[l]?.contentReview ?? "pending"} />
                      {game.locales[l]?.contentReview === "approved" ? "已通过" : game.locales[l]?.contentReview === "rejected" ? "已拒绝" : "待审核"}
                    </span>
                    {game.locales[l]?.reviewedAt ? `（${new Date(game.locales[l].reviewedAt!).toLocaleString("zh-CN")}）` : null}
                  </p>
                  <Labeled label="本地化别名（可选，参与本语言搜索）" error={fieldErrors[`locales.${l}.alias`]}>
                    <input
                      value={localeDraft[l].alias}
                      onChange={(e) => setLocaleDraft((d) => ({ ...d, [l]: { ...d[l], alias: e.target.value } }))}
                      className={`${inputCls} w-full`}
                    />
                  </Labeled>
                  <Labeled
                    label={l === "zh" ? "一句话说明（20–120 字）" : "一句话说明（40–300 字符）"}
                    error={fieldErrors[`locales.${l}.summary`]}
                    hint="原创；用于卡片和 meta description；不以游戏名开头"
                  >
                    <textarea
                      rows={2}
                      value={localeDraft[l].summary}
                      onChange={(e) => setLocaleDraft((d) => ({ ...d, [l]: { ...d[l], summary: e.target.value } }))}
                      className="w-full rounded-input border border-hairline bg-surface p-3 text-[14px] focus:border-trail focus:outline-none"
                    />
                  </Labeled>
                  <Labeled
                    label={l === "zh" ? "简介（50–3000 字）" : "简介（100–5000 字符）"}
                    error={fieldErrors[`locales.${l}.description`]}
                    hint="纯文本，可用换行分段；按「玩法概述 → 目标 → 特色/模式 → 适合谁」组织"
                  >
                    <textarea
                      rows={7}
                      value={localeDraft[l].description}
                      onChange={(e) => setLocaleDraft((d) => ({ ...d, [l]: { ...d[l], description: e.target.value } }))}
                      className="w-full rounded-input border border-hairline bg-surface p-3 text-[14px] leading-relaxed focus:border-trail focus:outline-none"
                    />
                  </Labeled>
                  <Labeled label="操作（每行一条「按键：动作」；没有证据就留空）" error={fieldErrors[`locales.${l}.controls`]}>
                    <textarea
                      rows={3}
                      value={localeDraft[l].controls}
                      onChange={(e) => setLocaleDraft((d) => ({ ...d, [l]: { ...d[l], controls: e.target.value } }))}
                      className="w-full rounded-input border border-hairline bg-surface p-3 font-mono text-[13px] focus:border-trail focus:outline-none"
                    />
                  </Labeled>
                  <Labeled label="封面 alt 文本（1–150 字符，本语言）" error={fieldErrors[`locales.${l}.mediaAlt`]}>
                    <input
                      value={localeDraft[l].coverAlt}
                      onChange={(e) => setLocaleDraft((d) => ({ ...d, [l]: { ...d[l], coverAlt: e.target.value } }))}
                      className={`${inputCls} w-full`}
                    />
                  </Labeled>
                </div>
              ) : null,
            )}
          </Section>

          {/* Action bar */}
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-hairline bg-paper/95 py-4 backdrop-blur-sm">
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              保存
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await save([activeLocale], true)) {
                  setNotice({ text: "已保存当前语言修改，门禁清单已更新。", ok: true });
                }
              }}
            >
              保存并刷新门禁
            </Button>
            <Button disabled={busy} onClick={() => setConfirm({ kind: "publish", locales: publishableLocales(gates) })}>
              发布…
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const d = await adminApi.preview(game.id, activeLocale);
                  setPreview(d);
                } catch (e) {
                  setNotice({ text: e instanceof Error ? e.message : "预览失败", ok: false });
                } finally {
                  setBusy(false);
                }
              }}
            >
              预览（{activeLocale === "en" ? "EN" : "中文"}）
            </Button>
            {game.status !== "unlisted" ? (
              <Button danger disabled={busy} onClick={() => setConfirm({ kind: "unlist" })}>
                下架…
              </Button>
            ) : null}
            <Button
              danger={game.outboundDisabled}
              disabled={busy}
              onClick={() => setConfirm({ kind: "outbound", enabled: game.outboundDisabled })}
            >
              {game.outboundDisabled ? "重新开启 CTA…" : "关闭 CTA…"}
            </Button>
            <Button disabled={busy} onClick={() => setConfirm({ kind: "linkcheck" } as never) } hidden>
              hidden
            </Button>
          </div>
        </div>

        {/* Gate checklist */}
        <aside className="space-y-4">
          <GateChecklist gates={gates} />
          <div className="rounded-card border border-hairline bg-surface p-4">
            <h2 className="label-mono-sm mb-3 text-ink-muted">手动链接检查</h2>
            <LinkCheckForm
              disabled={busy}
              onSubmit={async (status, note) => {
                if (await act(() => adminApi.linkCheck(game.id, { status, note }))) {
                  setNotice({ text: "链接状态已更新。", ok: true });
                }
              }}
            />
          </div>
        </aside>
      </div>

      {/* Dialogs */}
      <ConfirmDialog
        open={confirm?.kind === "unlist"}
        title="下架这款游戏？"
        body="下架后立即从公开列表、搜索和热门视图中移除，详情页返回 410。恢复前需重新走发布校验。"
        confirmLabel="确认下架"
        requireReason
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async (reason) => {
          setConfirm(null);
          if (await act(() => adminApi.unlist(game.id, reason))) setNotice({ text: "已下架。", ok: true });
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === "outbound"}
        title={confirm?.kind === "outbound" && confirm.enabled ? "重新开启 CTA？" : "关闭出站 CTA？"}
        body={
          confirm?.kind === "outbound" && confirm.enabled
            ? "开启后详情页恢复「在 CrazyGames 游玩」按钮。"
            : "关闭后详情页显示「外部链接暂不可用」，CTA 停用。"
        }
        confirmLabel={confirm?.kind === "outbound" && confirm.enabled ? "确认开启" : "确认关闭"}
        requireReason
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async (reason) => {
          if (confirm?.kind !== "outbound") return;
          const enabled = confirm.enabled;
          setConfirm(null);
          if (await act(() => adminApi.outbound(game.id, enabled, reason)))
            setNotice({ text: enabled ? "CTA 已开启。" : "CTA 已关闭。", ok: true });
        }}
      />
      <PublishDialog
        open={confirm?.kind === "publish"}
        game={game}
        gates={gates}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={async (locales) => {
          setConfirm(null);
          if (await act(() => adminApi.publish(game.id, { revisionVersion: game.revisionVersion, locales })))
            setNotice({ text: `已发布：${locales.join("、")}。`, ok: true });
        }}
      />
      {/* publish locale checkboxes rendered as extra body — simplified: pass through publishable locales */}

      <ConflictDialog
        open={conflict}
        onReload={async () => {
          setConflict(false);
          await load();
          setNotice({ text: "已重新加载服务器上的最新版本。", ok: true });
        }}
        onClose={() => setConflict(false)}
      />

      {/* Preview modal */}
      {preview ? <PreviewModal detail={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

function localeState(g: AdminGame, l: Locale) {
  const loc = g.locales[l];
  const altKey = g.coverAssetId ?? "";
  return {
    alias: loc?.alias ?? "",
    summary: loc?.summary ?? "",
    description: loc?.description ?? "",
    controls: loc?.controls ?? "",
    coverAlt: (loc?.mediaAlt?.[altKey] as string) ?? "",
  };
}

const GAME_GATE_FIELD_ZH: Record<string, string> = {
  cover: "封面素材",
  materialReview: "素材审核",
  externalUrl: "外链",
  linkStatus: "链接检查",
  primaryCategory: "主类别",
  tags: "标签",
  sourceUrl: "来源 URL",
  sourceFetchedAt: "来源核实时间",
  deviceSupport: "设备支持",
  deviceEvidenceUrl: "设备证据",
  name: "游戏名",
  slug: "slug",
};
const LOCALE_GATE_FIELD_ZH: Record<string, string> = {
  contentReview: "内容审核",
  summary: "一句话说明",
  description: "简介",
  alias: "本地化别名",
  mediaAlt: "封面 alt 文本",
  controls: "操作说明",
};
const GATE_MESSAGE_ZH: Record<string, string> = {
  "not approved": "未通过审核",
  required: "缺失",
  missing: "缺失",
  "too short": "过短",
  "too long": "过长",
  invalid: "无效",
};
/** Known gate fields/messages render in Chinese; unknown ones fall back to raw text. */
function gateFailureText(f: { field: string; message: string }): string {
  const msg = GATE_MESSAGE_ZH[f.message.toLowerCase()] ?? f.message;
  const m = /^locales\.(en|zh)\.(.+)$/.exec(f.field);
  if (m) {
    const localeLabel = m[1] === "en" ? "English" : "简体中文";
    const field = LOCALE_GATE_FIELD_ZH[m[2]] ?? m[2];
    return `${localeLabel} · ${field}：${msg}`;
  }
  return `${GAME_GATE_FIELD_ZH[f.field] ?? f.field}：${msg}`;
}

function sharedFrom(g: AdminGame) {
  return {
    name: g.name,
    developer: g.developer,
    primaryCategory: g.primaryCategory ?? "",
    tags: g.tags,
    coverAssetId: g.coverAssetId,
    coverSourcePath: g.coverSourcePath,
    screenshotAssetIds: g.screenshotAssetIds,
    usePlaceholder: g.usePlaceholder,
    materialReview: g.materialReview,
    featured: g.featured,
    editorialOrder: g.editorialOrder,
    deviceSupport: g.deviceSupport,
  };
}

function publishableLocales(gates: GateReport | null): Locale[] {
  if (!gates) return [];
  return LOCALES.filter((l) => gates.locales[l]?.ok);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-hairline bg-surface p-5">
      <h2 className="label-mono mb-4 text-ink-muted">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function GateChecklist({ gates }: { gates: GateReport | null }) {
  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <h2 className="label-mono-sm mb-3 text-ink-muted">发布门禁（实时）</h2>
      {!gates ? (
        <p className="text-[13px] text-ink-muted">加载中…</p>
      ) : (
        <div className="space-y-3">
          <GateGroup label="游戏级" ok={gates.game.ok} failures={gates.game.failures} />
          {(["en", "zh"] as const).map((l) => (
            <GateGroup
              key={l}
              label={l === "en" ? "English" : "简体中文"}
              ok={gates.locales[l]?.ok ?? false}
              failures={gates.locales[l]?.failures ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GateGroup({ label, ok, failures }: { label: string; ok: boolean; failures: { field: string; message: string }[] }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[13px] font-medium">
        <span aria-hidden="true" className={ok ? "text-moss" : "text-signal"}>
          {ok ? "✓" : "✗"}
        </span>
        {label}
        <span className={`label-mono-sm ${ok ? "text-moss" : "text-signal"}`}>{ok ? "通过" : "未通过"}</span>
      </p>
      {!ok && failures.length > 0 ? (
        <ul className="mt-1.5 space-y-1 pl-6">
          {failures.map((f, i) => (
            <li key={i} className="text-[12px] text-signal">
              {gateFailureText(f)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LinkCheckForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (status: "valid" | "suspect" | "invalid", note: string) => void }) {
  const [status, setStatus] = useState<"valid" | "suspect" | "invalid">("valid");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={`${inputCls} w-full`}>
        <option value="valid">有效（已人工确认打开的是目标游戏页）</option>
        <option value="suspect">可疑</option>
        <option value="invalid">失效</option>
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（可选）" className={`${inputCls} w-full`} />
      <Button className="w-full" disabled={disabled} onClick={() => onSubmit(status, note)}>
        提交链接检查
      </Button>
    </div>
  );
}

/** Publish dialog with per-locale selection, defaulted to gate-passing locales. */
function PublishDialog({
  open,
  game,
  gates,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  game: AdminGame;
  gates: GateReport | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (locales: Locale[]) => void;
}) {
  const [selected, setSelected] = useState<Locale[]>([]);
  if (open && selected.length === 0) {
    setSelected(publishableLocales(gates));
  }

  return (
    <ConfirmDialog
      open={open}
      title="发布"
      body={
        <span>
          选择要上线的语言（每语言独立通过门禁）。当前版本：{game.revisionVersion}。
          发布后公开 API 与页面最迟 60 秒内一致。
        </span>
      }
      confirmLabel="确认发布"
      busy={busy}
      onClose={onClose}
      onConfirm={() => onConfirm(selected)}
    >
      {LOCALES.map((l) => {
        const gateOk = gates?.locales[l]?.ok ?? false;
        const checked = selected.includes(l);
        return (
          <label key={l} className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={checked}
              disabled={!gateOk}
              onChange={(e) => setSelected((s) => (e.target.checked ? [...s, l] : s.filter((x) => x !== l)))}
            />
            {l === "en" ? "English" : "简体中文"}
            <span className={`label-mono-sm ${gateOk ? "text-moss" : "text-signal"}`}>
              {gateOk ? "门禁通过" : "门禁未通过"}
            </span>
          </label>
        );
      })}
    </ConfirmDialog>
  );
}

/** 409 conflict: never auto-overwrite; offer an explicit reload. */
function ConflictDialog({ open, onReload, onClose }: { open: boolean; onReload: () => void; onClose: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      title="版本冲突（409）"
      body="其他会话或旧标签页已经修改了这款游戏。为避免覆盖他人修改，本页未保存。请重新加载后在新版本上继续编辑。"
      confirmLabel="重新加载最新版本"
      busy={false}
      onClose={onClose}
      onConfirm={onReload}
    />
  );
}

/** Minimal public-look preview modal (uses the /preview draft payload). */
function PreviewModal({ detail, onClose }: { detail: GameDetail; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/50 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="预览"
        className="mx-auto max-w-[760px] rounded-card border border-hairline bg-paper p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="label-mono text-ink-muted">草稿预览（不会公开，不进入公开缓存）</span>
          <Button onClick={onClose}>关闭</Button>
        </div>
        <div className="aspect-video overflow-hidden rounded-cover border border-hairline bg-surface-sunk">
          {detail.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={detail.cover.url} alt={detail.cover.alt} className="h-full w-full object-cover" />
          ) : null}
        </div>
        <h1 className="mt-4 font-display text-[28px] font-bold tracking-tight">{detail.name}</h1>
        {detail.alias ? <p className="text-[14px] text-ink-muted">{detail.alias}</p> : null}
        <p className="mt-3 text-[16px]">{detail.summary}</p>
        <p className="mt-2 flex flex-wrap gap-2">
          {detail.tags.map((t) => (
            <span key={t.slug} className="label-mono-sm rounded-full border border-hairline px-2.5 py-1 text-ink-muted">
              {t.name}
            </span>
          ))}
        </p>
        <div className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed">{detail.description}</div>
        {detail.controls ? (
          <div className="mt-4 rounded-card border border-hairline bg-surface p-4 font-mono text-[13px] whitespace-pre-wrap">{detail.controls}</div>
        ) : (
          <p className="mt-4 text-[13px] italic text-ink-muted">操作信息待核实</p>
        )}
        <p className="mt-4 text-[13px] text-ink-muted">
          {detail.outboundAllowed ? `外部链接可用：${detail.ctaUrl}` : "外部链接暂不可用"}
        </p>
      </div>
    </div>
  );
}
