import { getTranslations, setRequestLocale } from "next-intl/server";
import { getLiveLocales } from "@/lib/api/server";
import { pageMetadata } from "@/lib/seo";
import { LegalPage, LegalParagraph, LegalSection, PendingNote } from "@/components/layout/LegalPage";

export async function generateMetadata({ params }: PageProps<"/[locale]/privacy">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.privacy" });
  const liveLocales = await safeLiveLocales();
  return pageMetadata({ locale, liveLocales, path: `/${locale}/privacy`, title: t("title"), description: t("title") });
}

async function safeLiveLocales(): Promise<string[]> {
  try {
    return await getLiveLocales();
  } catch {
    return [];
  }
}

export default async function PrivacyPage({ params }: PageProps<"/[locale]/privacy">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");

  return (
    <LegalPage eyebrow={t("eyebrow")} title={t("title")} lead={t("p1")}>
      <LegalSection title={t("h2Events")}>
        <LegalParagraph>{t("p2")}</LegalParagraph>
        <LegalParagraph>{t("p3")}</LegalParagraph>
      </LegalSection>
      <LegalSection title={t("h2Cookies")}>
        <LegalParagraph>{t("p4")}</LegalParagraph>
      </LegalSection>
      <LegalSection title={t("h2Respect")}>
        <LegalParagraph>{t("p5")}</LegalParagraph>
      </LegalSection>
      <LegalSection title={t("h2Logs")}>
        <LegalParagraph>{t("p6")}</LegalParagraph>
      </LegalSection>
      <LegalSection title={t("h2Contact")}>
        <LegalParagraph>{t("p7")}</LegalParagraph>
        <PendingNote label={t("pending")} />
      </LegalSection>
    </LegalPage>
  );
}
