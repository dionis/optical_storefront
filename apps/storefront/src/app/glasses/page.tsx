import type { Metadata } from "next";
import { parseFilterParams } from "@/lib/filter-params";
import { GlassesClientPage } from "./glasses-client";

export const metadata: Metadata = {
  title: "Monturas",
  description:
    "Explora nuestra amplia selección de monturas para lentes graduados. Filtra por forma, material y estilo.",
};

interface GlassesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function GlassesPage({ searchParams }: GlassesPageProps) {
  const params = await searchParams;
  const initialFilters = parseFilterParams(params);

  return <GlassesClientPage initialFilters={initialFilters} />;
}
