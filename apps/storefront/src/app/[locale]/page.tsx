import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";

const COLLECTION_SLUGS = [
  "di-caprio",
  "simply-lite",
  "trendy",
  "millennial",
  "flexure",
  "slimfold",
] as const;

const SHAPE_PARAMS = ["round", "rectangle", "aviator", "cat_eye", "square", "oval"] as const;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <div className="max-w-2xl">
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-gray-900 leading-[1.1] mb-6">
              {t("heroTitlePlain")}{" "}
              <span className="text-accent">{t("heroTitleAccent")}</span>
            </h1>
            <p className="text-xl text-gray-500 mb-8 leading-relaxed">
              {t("heroSubtitle")}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/glasses"
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {t("ctaBrowse")}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/try-on"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {t("ctaTryOn")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* By shape */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">{t("byShape")}</h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {SHAPE_PARAMS.map((shape) => (
            <Link
              key={shape}
              href={`/glasses?shape=${shape}`}
              className="flex flex-col items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-4 text-center hover:border-accent/30 hover:bg-accent/5 transition-colors group"
            >
              <span className="text-2xl">👓</span>
              <span className="text-xs font-medium text-gray-700 group-hover:text-accent transition-colors">
                {t(`shapes.${shape}`)}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Collections */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">{t("collections")}</h2>
          <Link
            href="/glasses"
            className="text-sm font-medium text-accent hover:underline underline-offset-2"
          >
            {t("viewAll")}
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {COLLECTION_SLUGS.map((slug) => (
            <Link
              key={slug}
              href={`/glasses?collection=${slug}`}
              className="group relative overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 p-6 hover:border-gray-200 hover:shadow-sm transition-all"
            >
              <div className="mb-3 h-24 rounded-xl bg-white flex items-center justify-center text-4xl">
                👓
              </div>
              <h3 className="font-semibold text-gray-900 group-hover:text-accent transition-colors">
                {t(`collectionList.${slug}.label`)}
              </h3>
              <p className="mt-1 text-sm text-gray-500">{t(`collectionList.${slug}.desc`)}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Gender entry points */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">{t("byGender")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(["women", "men", "unisex"] as const).map((gender) => {
              const emojis = { women: "👩", men: "👨", unisex: "🧑" };
              return (
                <Link
                  key={gender}
                  href={`/glasses?gender=${gender}`}
                  className="group flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-5 hover:border-accent/30 hover:shadow-sm transition-all"
                >
                  <span className="text-3xl">{emojis[gender]}</span>
                  <span className="font-semibold text-gray-900 group-hover:text-accent transition-colors">
                    {t(`genders.${gender}`)}
                  </span>
                  <ArrowRight className="ml-auto h-4 w-4 text-gray-400 group-hover:text-accent transition-colors" />
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
