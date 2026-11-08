import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LogoMark } from "./Header";
import { FooterLanguages } from "./FooterLanguages";
import { getLiveLocales } from "@/lib/api/server";

export async function Footer({ locale }: { locale: string }) {
  const t = await getTranslations("footer");
  let liveLocales: string[] = [];
  try {
    liveLocales = await getLiveLocales();
  } catch {
    // Footer language links fall back to the plain locale roots.
  }

  return (
    <footer className="mt-24 border-t border-hairline bg-surface">
      {/* Full-width trail line along the top edge (DESIGN §6.1.5) */}
      <div aria-hidden="true" className="h-0 w-full border-t-2 border-dashed border-trail/70" />
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Link href={`/${locale}`} className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-display text-[19px] font-bold tracking-tight text-ink">PlayTrail</span>
            {locale === "zh" ? <span className="text-[14px] text-ink-muted">游引</span> : null}
          </Link>
          <p className="mt-3 max-w-[40ch] text-[14px] text-ink-muted">{t("tagline")}</p>
        </div>
        <nav aria-label={t("site")} className="text-[14px]">
          <h2 className="label-mono mb-3 text-ink-muted">{t("site")}</h2>
          <ul className="space-y-2.5">
            <li>
              <Link href={`/${locale}/about`} className="text-ink underline-offset-4 hover:underline">
                {t("about")}
              </Link>
            </li>
            <li>
              <Link href={`/${locale}/privacy`} className="text-ink underline-offset-4 hover:underline">
                {t("privacy")}
              </Link>
            </li>
            <li>
              <Link href={`/${locale}/copyright`} className="text-ink underline-offset-4 hover:underline">
                {t("copyright")}
              </Link>
            </li>
          </ul>
        </nav>
        <Suspense fallback={null}>
          <FooterLanguages locale={locale} liveLocales={liveLocales} />
        </Suspense>
      </div>
      <div className="border-t border-hairline">
        <p className="mx-auto max-w-[1240px] px-4 py-5 text-[13px] leading-relaxed text-ink-muted sm:px-6">
          {t("disclaimer")}
        </p>
      </div>
    </footer>
  );
}
