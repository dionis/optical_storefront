import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      {/* Hero */}
      <section className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center bg-gray-50">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-4">
          Lentes a tu medida
        </h1>
        <p className="text-lg text-gray-500 max-w-xl mb-8">
          Monturas de calidad con lentes graduados. Elige tu montura, sube tu
          receta y recíbelos en casa.
        </p>
        <Link
          href="/glasses"
          className="inline-flex items-center justify-center rounded-md bg-accent px-8 py-3 text-sm font-semibold text-white shadow hover:bg-accent-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Ver monturas
        </Link>
      </section>

      {/* Collections placeholder — populated in Phase 2 */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-semibold mb-8">Colecciones</h2>
        <p className="text-gray-400">
          El catálogo se cargará en la Fase 2 (ingesta del scraper).
        </p>
      </section>
    </main>
  );
}
