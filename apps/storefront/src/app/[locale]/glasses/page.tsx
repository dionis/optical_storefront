import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { parseFilterParams } from "@/lib/filter-params";
import { GlassesClientPage } from "./glasses-client";

interface GlassesPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: GlassesPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "listing" });
  return {
    title: t("title"),
    description: t("metaDescription"),
  };
}

export default async function GlassesPage({ searchParams }: GlassesPageProps) {
  const params = await searchParams;
  const initialFilters = parseFilterParams(params);

  return <GlassesClientPage initialFilters={initialFilters} />;
}
