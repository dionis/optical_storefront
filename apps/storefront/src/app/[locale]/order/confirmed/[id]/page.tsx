import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

interface Params {
  params: Promise<{ id: string; locale: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "orderConfirmed" });
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function OrderConfirmedPage({ params }: Params) {
  const { id, locale } = await params;
  const t = await getTranslations({ locale, namespace: "orderConfirmed" });

  return (
    <main className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="mb-6 flex justify-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-4xl">
          ✅
        </span>
      </div>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">{t("title")}</h1>
      <p className="text-gray-500 mb-2">
        {t("orderNumber")}{" "}
        <span className="font-mono font-semibold text-gray-900">{id}</span>
      </p>
      <p className="text-gray-500 mb-8">{t("emailNotice")}</p>

      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 text-sm text-left space-y-2 mb-8">
        <p className="font-semibold text-gray-700">{t("whatsNext")}</p>
        <ol className="space-y-1.5 text-gray-500 list-decimal list-inside">
          <li>{t("step1")}</li>
          <li>{t("step2")}</li>
          <li>{t("step3")}</li>
          <li>{t("step4")}</li>
        </ol>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href="/glasses"
          className="rounded-xl border border-gray-200 px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {t("continueShopping")}
        </Link>
      </div>
    </main>
  );
}
