import { Suspense } from "react";
import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { CategoryCount } from "@/lib/api/types";
import { getCategories, getLiveLocales } from "@/lib/api/server";
import { htmlLang, LOCALES } from "@/lib/i18n/routing";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SvgDefs } from "@/components/layout/SvgDefs";
import "@/app/globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
});

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

/** Unknown locale prefixes are a real 404, never a redirect (PRD 4.1). */
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.home" });
  let liveLocales: string[] = [];
  try {
    liveLocales = await getLiveLocales();
  } catch {
    // API unavailable: metadata degrades gracefully.
  }
  return {
    metadataBase: new URL(process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"),
    title: t("title"),
    // A locale below the live threshold is entirely noindex (PRD 12.6).
    robots:
      liveLocales.length > 0 && !liveLocales.includes(locale) ? { index: false, follow: true } : undefined,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tA11y = await getTranslations({ locale, namespace: "a11y" });

  let liveLocales: string[] = [];
  let categories: CategoryCount[] = [];
  try {
    [liveLocales, categories] = await Promise.all([
      getLiveLocales(),
      getCategories(locale).then((c) => c.items),
    ]);
  } catch {
    // Header renders without categories; pages handle their own error states.
  }

  return (
    <html lang={htmlLang(locale)} className={display.variable}>
      <body className="min-h-dvh">
        <SvgDefs />
        <NextIntlClientProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-input focus:bg-trail focus:px-4 focus:py-2 focus:text-trail-ink"
          >
            {tA11y("skipToContent")}
          </a>
          <Suspense fallback={null}>
            <Header locale={locale} categories={categories} liveLocales={liveLocales} />
          </Suspense>
          <main id="main">{children}</main>
          <Footer locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
