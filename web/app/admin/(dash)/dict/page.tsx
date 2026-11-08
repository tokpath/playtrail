"use client";

import { useState } from "react";
import { adminApi, useApi, type AdminCategory, type AdminTag } from "@/lib/api/admin";
import { Button, ErrorBanner, Labeled, PageHeader, Table, inputCls } from "@/components/admin/ui";

/** 字典（PRD §07）：类别名称/排序，标签增改停用，CrazyGames 标签映射。 */
export default function AdminDictPage() {
  const [tab, setTab] = useState<"categories" | "tags" | "mappings">("categories");
  const categories = useApi<{ items: AdminCategory[] }>("/api/admin/categories");
  const tags = useApi<{ items: AdminTag[] }>("/api/admin/tags");
  const mappings = useApi<{ items: { sourceTagSlug: string; tagSlug?: string | null }[] }>("/api/admin/tag-mappings");
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  return (
    <div>
      <PageHeader
        title="字典"
        actions={
          <div className="flex gap-1 rounded-input bg-surface-sunk p-1">
            {(
              [
                ["categories", "类别"],
                ["tags", "标签"],
                ["mappings", "标签映射"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
                className={`h-8 rounded-[9px] px-3 text-[13px] ${tab === key ? "bg-surface text-ink ring-1 ring-hairline" : "text-ink-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      {notice ? (
        <p className={`mb-4 text-[13px] ${notice.ok ? "text-moss" : "text-signal"}`}>{notice.text}</p>
      ) : null}

      {tab === "categories" ? (
        <CategoryEditor
          categories={categories}
          onDone={(text) => {
            setNotice({ text, ok: true });
            categories.reload();
          }}
        />
      ) : tab === "tags" ? (
        <TagEditor
          tags={tags}
          onDone={(text) => {
            setNotice({ text, ok: true });
            tags.reload();
          }}
        />
      ) : (
        <MappingEditor mappings={mappings} tags={tags} onDone={(text) => setNotice({ text, ok: true })} />
      )}
    </div>
  );
}

type ApiState<T> = { data: T | null; error: import("@/lib/api/admin").AdminApiError | null; loading: boolean; reload: () => void };

function CategoryEditor({ categories, onDone }: { categories: ApiState<{ items: AdminCategory[] }>; onDone: (text: string) => void }) {
  const [drafts, setDrafts] = useState<Record<string, { en: string; zh: string; sortOrder: number }>>({});
  const [busy, setBusy] = useState(false);

  // Derive drafts during render (React "adjust state on props change").
  if (categories.data && Object.keys(drafts).length === 0) {
    const d: typeof drafts = {};
    for (const c of categories.data.items) {
      d[c.slug] = { en: c.names.en ?? "", zh: c.names.zh ?? "", sortOrder: c.sortOrder };
    }
    setDrafts(d);
  }

  const save = async (slug: string) => {
    setBusy(true);
    try {
      const d = drafts[slug];
      await adminApi.patchCategory(slug, { names: { en: d.en, zh: d.zh }, sortOrder: d.sortOrder });
      onDone(`${slug} 已保存。`);
    } catch (e) {
      onDone(e instanceof Error ? `保存失败：${e.message}` : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  if (categories.loading) return <p className="text-ink-muted">加载中…</p>;
  if (categories.error) return <ErrorBanner error={categories.error} onReload={categories.reload} />;

  return (
    <Table head={["slug", "英文名", "中文名", "排序", ""]}>
      {(categories.data?.items ?? []).map((c) => {
        const d = drafts[c.slug];
        return (
          <tr key={c.slug} className="hover:bg-surface-sunk">
            <td className="label-mono px-4 py-3 text-ink-muted">{c.slug}</td>
            <td className="px-4 py-2">
              <input
                value={d?.en ?? ""}
                onChange={(e) => setDrafts((m) => ({ ...m, [c.slug]: { ...m[c.slug], en: e.target.value } }))}
                className={`${inputCls} w-full min-w-[160px]`}
              />
            </td>
            <td className="px-4 py-2">
              <input
                value={d?.zh ?? ""}
                onChange={(e) => setDrafts((m) => ({ ...m, [c.slug]: { ...m[c.slug], zh: e.target.value } }))}
                className={`${inputCls} w-full min-w-[140px]`}
              />
            </td>
            <td className="px-4 py-2">
              <input
                type="number"
                value={d?.sortOrder ?? 0}
                onChange={(e) => setDrafts((m) => ({ ...m, [c.slug]: { ...m[c.slug], sortOrder: Number(e.target.value) } }))}
                className={`${inputCls} w-[80px]`}
              />
            </td>
            <td className="px-4 py-3 text-right">
              <Button disabled={busy} onClick={() => void save(c.slug)}>
                保存
              </Button>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

function TagEditor({ tags, onDone }: { tags: ApiState<{ items: AdminTag[] }>; onDone: (text: string) => void }) {
  const [newSlug, setNewSlug] = useState("");
  const [newEn, setNewEn] = useState("");
  const [newZh, setNewZh] = useState("");
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, { en: string; zh: string }>>({});

  const create = async () => {
    setBusy(true);
    try {
      await adminApi.createTag({ slug: newSlug.trim(), names: { en: newEn.trim(), zh: newZh.trim() } });
      setNewSlug("");
      setNewEn("");
      setNewZh("");
      onDone(`标签 ${newSlug.trim()} 已创建。`);
      tags.reload();
    } catch (e) {
      onDone(e instanceof Error ? `创建失败：${e.message}` : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const saveTag = async (slug: string) => {
    setBusy(true);
    try {
      const d = edits[slug];
      await adminApi.patchTag(slug, { names: { en: d.en, zh: d.zh } });
      onDone(`${slug} 已保存。`);
      tags.reload();
    } catch (e) {
      onDone(e instanceof Error ? `保存失败：${e.message}` : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (tag: AdminTag) => {
    setBusy(true);
    try {
      await adminApi.patchTag(tag.slug, { active: !tag.active });
      onDone(tag.active ? `${tag.slug} 已停用（不能用于新发布）。` : `${tag.slug} 已启用。`);
      tags.reload();
    } catch (e) {
      onDone(e instanceof Error ? `操作失败：${e.message}` : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <form className="flex flex-wrap items-end gap-3 rounded-card border border-hairline bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <Labeled label="新标签 slug">
          <input value={newSlug} onChange={(e) => setNewSlug(e.target.value)} className={`${inputCls} w-[180px] font-mono`} placeholder="例：roguelike" />
        </Labeled>
        <Labeled label="英文名">
          <input value={newEn} onChange={(e) => setNewEn(e.target.value)} className={`${inputCls} w-[160px]`} />
        </Labeled>
        <Labeled label="中文名">
          <input value={newZh} onChange={(e) => setNewZh(e.target.value)} className={`${inputCls} w-[140px]`} />
        </Labeled>
        <Button type="submit" variant="primary" disabled={busy || !newSlug.trim()}>
          新增标签
        </Button>
      </form>

      {tags.loading ? (
        <p className="text-ink-muted">加载中…</p>
      ) : tags.error ? (
        <ErrorBanner error={tags.error} onReload={tags.reload} />
      ) : (
        <Table head={["slug", "英文名", "中文名", "状态", ""]}>
          {(tags.data?.items ?? []).map((t) => {
            const d = edits[t.slug] ?? { en: t.names.en ?? "", zh: t.names.zh ?? "" };
            return (
              <tr key={t.slug} className="hover:bg-surface-sunk">
                <td className="label-mono px-4 py-3 text-ink-muted">{t.slug}</td>
                <td className="px-4 py-2">
                  <input
                    value={d.en}
                    onChange={(e) => setEdits((m) => ({ ...m, [t.slug]: { ...m[t.slug] ?? d, en: e.target.value } }))}
                    className={`${inputCls} w-full min-w-[150px]`}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    value={d.zh}
                    onChange={(e) => setEdits((m) => ({ ...m, [t.slug]: { en: m[t.slug]?.en ?? t.names.en ?? "", zh: e.target.value } }))}
                    className={`${inputCls} w-full min-w-[130px]`}
                  />
                </td>
                <td className="px-4 py-3">
                  <span className={`label-mono-sm ${t.active ? "text-moss" : "text-ink-muted"}`}>{t.active ? "启用" : "已停用"}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="space-x-2">
                    <Button disabled={busy} onClick={() => void saveTag(t.slug)}>
                      保存
                    </Button>
                    <Button danger={t.active} disabled={busy} onClick={() => void toggleActive(t)}>
                      {t.active ? "停用" : "启用"}
                    </Button>
                  </span>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      <p className="text-[12px] text-ink-muted">被引用的标签不可删除，只能停用；停用后不能用于新发布。</p>
    </div>
  );
}

function MappingEditor({
  mappings,
  tags,
  onDone,
}: {
  mappings: ApiState<{ items: { sourceTagSlug: string; tagSlug?: string | null }[] }>;
  tags: ApiState<{ items: AdminTag[] }>;
  onDone: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const put = async (sourceTagSlug: string, tagSlug: string | null) => {
    setBusy(true);
    try {
      await adminApi.putTagMapping(sourceTagSlug, tagSlug);
      onDone(`${sourceTagSlug} 映射已保存。`);
      mappings.reload();
    } catch (e) {
      onDone(e instanceof Error ? `保存失败：${e.message}` : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  if (mappings.loading) return <p className="text-ink-muted">加载中…</p>;
  if (mappings.error) return <ErrorBanner error={mappings.error} onReload={mappings.reload} />;

  return (
    <div>
      <p className="mb-4 max-w-[80ch] text-[13px] text-ink-muted">
        CrazyGames 来源标签 → 本站标签的映射（PRD §22.6）：爬虫按映射预填游戏标签；选择「忽略」则该来源标签不产生本站标签。
      </p>
      <Table head={["CrazyGames 标签", "本站标签", ""]}>
        {(mappings.data?.items ?? []).map((m) => (
          <tr key={m.sourceTagSlug} className="hover:bg-surface-sunk">
            <td className="label-mono px-4 py-2.5 text-ink-muted">{m.sourceTagSlug}</td>
            <td className="px-4 py-2">
              <select
                value={m.tagSlug ?? ""}
                disabled={busy}
                onChange={(e) => void put(m.sourceTagSlug, e.target.value || null)}
                className={`${inputCls} w-[220px]`}
              >
                <option value="">忽略（不映射）</option>
                {(tags.data?.items ?? []).filter((t) => t.active).map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.names.zh ?? t.slug}（{t.slug}）
                  </option>
                ))}
              </select>
            </td>
            <td className="px-4 py-2.5" />
          </tr>
        ))}
      </Table>
    </div>
  );
}
