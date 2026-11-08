import { getTranslations, setRequestLocale } from "next-intl/server";
import { getLiveLocales } from "@/lib/api/server";
import { pageMetadata } from "@/lib/seo";
import { LegalPage, LegalParagraph, LegalSection, PendingNote } from "@/components/layout/LegalPage";

export async function generateMetadata({ params }: PageProps<"/[locale]/copyright">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.copyright" });
  const liveLocales = await safeLiveLocales();
  return pageMetadata({ locale, liveLocales, path: `/${locale}/copyright`, title: t("title"), description: t("title") });
}

async function safeLiveLocales(): Promise<string[]> {
  try {
    return await getLiveLocales();
  } catch {
    return [];
  }
}

export default async function CopyrightPage({ params }: PageProps<"/[locale]/copyright">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("copyright");

  return (
    <LegalPage eyebrow={t("eyebrow")} title={t("title")} lead={t("p1")}>
      <LegalSection title={t("h2Corrections")}>
        <LegalParagraph>{t("p2")}</LegalParagraph>
      </LegalSection>
      <LegalSection title={t("h2Rights")}>
        <LegalParagraph>{t("p3")}</LegalParagraph>
        <PendingNote label={t("pending")}>{t("contactPending")}</PendingNote>
      </LegalSection>
      <LegalSection title={t("h2Trademarks")}>
        <LegalParagraph>{t("p4")}</LegalParagraph>
      </LegalSection>
    </LegalPage>
  );
}
