import { headers } from "next/headers";
import { Bricolage_Grotesque } from "next/font/google";
import { getMessages } from "next-intl/server";
import { matchLocale } from "@/lib/i18n/accept-language";
import { DEFAULT_LOCALE, htmlLang } from "@/lib/i18n/routing";
import { EmptyIllustration } from "@/components/ui/EmptyState";
import "@/app/globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
});

/**
 * Global 404 for unprefixed, unmatched paths (PRD 4.1: a real 404 whose copy
 * follows Accept-Language; never a redirect-then-404). Must render a full
 * HTML document since it bypasses the locale layout.
 */
export const metadata = {
  title: "404",
  robots: { index: false, follow: false },
};

export default async function GlobalNotFound() {
  const headerList = await headers();
  const locale = matchLocale(headerList.get("accept-language"), ["en", "zh"]) ?? DEFAULT_LOCALE;
  const messages = (await getMessages({ locale })) as { empty: { notFoundTitle: string; notFoundBody: string; backHome: string } };

  return (
    <html lang={htmlLang(locale)} className={display.variable}>
      <body className="min-h-dvh">
        <main className="flex min-h-dvh items-center justify-center px-6 py-12">
          <div className="flex w-full max-w-[560px] flex-col items-center rounded-card border border-hairline bg-surface px-6 py-14 text-center">
            <EmptyIllustration />
            <h1 className="mt-6 font-display text-[24px] font-semibold tracking-tight text-ink">
              {messages.empty.notFoundTitle}
            </h1>
            <p className="mt-2 text-[15px] text-ink-muted">{messages.empty.notFoundBody}</p>
            <a
              href={`/${locale}`}
              className="mt-6 inline-flex h-11 items-center rounded-input border border-hairline px-5 text-[14px] text-ink hover:border-ink"
            >
              {messages.empty.backHome}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
