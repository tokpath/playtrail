"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi, AdminApiError } from "@/lib/api/admin";
import { Button, ErrorBanner, Labeled, PageHeader, inputCls } from "@/components/admin/ui";

export default function AdminGameNewPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    slug: "",
    externalUrl: "",
    sourceUrl: "",
    sourceFetchedAt: new Date().toISOString().slice(0, 16),
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<AdminApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const game = await adminApi.createGame({
        name: form.name.trim(),
        externalUrl: form.externalUrl.trim(),
        sourceUrl: form.sourceUrl.trim(),
        sourceFetchedAt: new Date(form.sourceFetchedAt).toISOString(),
        ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
      });
      router.push(`/admin/games/${game.id}`);
    } catch (err) {
      if (err instanceof AdminApiError) {
        setError(err);
        setFieldErrors(err.fieldErrors ?? {});
      }
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[640px]">
      <PageHeader title="新增游戏" />
      {error && error.status !== 422 ? <ErrorBanner error={error} /> : null}
      <form onSubmit={submit} className="space-y-5 rounded-card border border-hairline bg-surface p-5">
        <Labeled label="游戏名（官方英文名，1–150 字符）" error={fieldErrors.name}>
          <input required value={form.name} onChange={set("name")} className={`${inputCls} w-full`} />
        </Labeled>
        <Labeled label="slug（可选，留空按名称生成）" error={fieldErrors.slug} hint="小写字母、数字和连字符；首次发布后不可修改">
          <input value={form.slug} onChange={set("slug")} className={`${inputCls} w-full font-mono`} />
        </Labeled>
        <Labeled label="外链 URL（CrazyGames 游戏页）" error={fieldErrors.externalUrl}>
          <input
            required
            type="url"
            placeholder="https://www.crazygames.com/game/…"
            value={form.externalUrl}
            onChange={set("externalUrl")}
            className={`${inputCls} w-full font-mono`}
          />
        </Labeled>
        <Labeled label="来源 URL（核对她时打开的页面）" error={fieldErrors.sourceUrl}>
          <input
            required
            type="url"
            placeholder="https://www.crazygames.com/game/…"
            value={form.sourceUrl}
            onChange={set("sourceUrl")}
            className={`${inputCls} w-full font-mono`}
          />
        </Labeled>
        <Labeled label="来源核实时间" error={fieldErrors.sourceFetchedAt}>
          <input
            required
            type="datetime-local"
            value={form.sourceFetchedAt}
            onChange={set("sourceFetchedAt")}
            className={`${inputCls} w-full`}
          />
        </Labeled>
        <p className="text-[12px] text-ink-muted">
          创建后为草稿，所有语言内容审核状态为「待审核」。分类、标签和各语言内容在编辑页补充。
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={() => router.back()}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "创建中…" : "创建草稿"}
          </Button>
        </div>
      </form>
    </div>
  );
}
