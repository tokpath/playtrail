import type { ReactNode } from "react";
import { ContourStrip } from "@/components/ui/ContourStrip";

/**
 * Legal / static page frame (DESIGN §6.6): single 68ch column, contour strip,
 * mono eyebrow, display title, 20px lead paragraph. `pending` blocks render
 * with an amber border and are marked for owner confirmation.
 */
export function LegalPage({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <article>
      <ContourStrip />
      <div className="mx-auto max-w-[720px] px-4 py-14 sm:px-6">
        <p className="label-mono text-ink-muted">{eyebrow}</p>
        <h1 className="mt-4 font-display text-[40px] font-bold leading-[1.1] tracking-[-0.02em] text-ink">{title}</h1>
        <p className="mt-6 text-[20px] leading-[1.75] text-ink">{lead}</p>
        <div className="mt-10 space-y-8">{children}</div>
      </div>
    </article>
  );
}

export function LegalSection({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className={title ? "" : "mt-8"}>
      {title ? <h2 className="font-display text-[22px] font-semibold tracking-tight text-ink">{title}</h2> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function LegalParagraph({ children }: { children: ReactNode }) {
  return <p className="text-[16px] leading-[1.75] text-ink">{children}</p>;
}

/** Amber “pending owner confirmation” callout (DESIGN §6.6). */
export function PendingNote({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="border-l-[3px] border-amber bg-amber/[0.07] px-4 py-3">
      <p className="label-mono text-amber">{label}</p>
      {children ? <p className="mt-2 text-[14px] leading-relaxed text-ink">{children}</p> : null}
    </div>
  );
}
