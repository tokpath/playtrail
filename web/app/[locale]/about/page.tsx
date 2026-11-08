import { getTranslations, setRequestLocale } from "next-intl/server";
import { getLiveLocales } from "@/lib/api/server";
import { pageMetadata } from "@/lib/seo";
import { LegalPage, LegalParagraph, LegalSection, PendingNote } from "@/components/layout/LegalPage";

export async function generateMetadata({ params }: PageProps<"/[locale]/about">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.about" });
  const liveLocales = await safeLiveLocales();
  return pageMetadata({ locale, liveLocales, path: `/${locale}/about`, title: t("title"), description: t("title") });
}

async function safeLiveLocales(): Promise<string[]> {
  try {
    return await getLiveLocales();
  } catch {
    return [];
  }
}

export default async function AboutPage({ params }: PageProps<"/[locale]/about">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");

  return (
    <LegalPage eyebrow={t("eyebrow")} title={t("title")} lead={t("p1")}>
      <LegalSection title={t("h2How")}>
        <LegalParagraph>{t("p2")}</LegalParagraph>
        <LegalParagraph>{t("p3")}</LegalParagraph>
      </LegalSection>
      <LegalSection title={t("h2Independence")}>
        <LegalParagraph>{t("p4")}</LegalParagraph>
        <PendingNote label={t("pending")} />
      </LegalSection>
      <LegalSection title={t("h2Contact")}>
        <LegalParagraph>{t("p5")}</LegalParagraph>
      </LegalSection>
    </LegalPage>
  );
}
