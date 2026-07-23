import Link from "next/link";
import { ArrowRight } from "lucide-react";

const COLLECTIONS = [
  { slug: "di-caprio", label: "Di Caprio", desc: "Elegancia clásica en acetato" },
  { slug: "simply-lite", label: "Simply Lite", desc: "Monturas ultra ligeras" },
  { slug: "trendy", label: "Trendy", desc: "Estilos a la moda" },
  { slug: "millennial", label: "Millennial", desc: "Diseños modernos y versátiles" },
  { slug: "flexure", label: "Flexure", desc: "Máxima flexibilidad TR90" },
  { slug: "slimfold", label: "Slimfold", desc: "Compactas y plegables" },
];

const SHAPES = [
  { label: "Redonda", param: "round" },
  { label: "Rectangular", param: "rectangle" },
  { label: "Aviador", param: "aviator" },
  { label: "Ojo de gato", param: "cat_eye" },
  { label: "Cuadrada", param: "square" },
  { label: "Oval", param: "oval" },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <div className="max-w-2xl">
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-gray-900 leading-[1.1] mb-6">
              Lentes a{" "}
              <span className="text-accent">tu medida</span>
            </h1>
            <p className="text-xl text-gray-500 mb-8 leading-relaxed">
              Elige tu montura favorita, sube tu receta y recibe tus lentes graduados en casa. Proceso simple, precios transparentes.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/glasses"
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Ver monturas
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/try-on"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Prueba virtual
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* By shape */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Por forma</h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {SHAPES.map((shape) => (
            <Link
              key={shape.param}
              href={`/glasses?shape=${shape.param}`}
              className="flex flex-col items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-4 text-center hover:border-accent/30 hover:bg-accent/5 transition-colors group"
            >
              <span className="text-2xl">👓</span>
              <span className="text-xs font-medium text-gray-700 group-hover:text-accent transition-colors">
                {shape.label}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Collections */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Colecciones</h2>
          <Link
            href="/glasses"
            className="text-sm font-medium text-accent hover:underline underline-offset-2"
          >
            Ver todas
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {COLLECTIONS.map((col) => (
            <Link
              key={col.slug}
              href={`/glasses?collection=${col.slug}`}
              className="group relative overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 p-6 hover:border-gray-200 hover:shadow-sm transition-all"
            >
              <div className="mb-3 h-24 rounded-xl bg-white flex items-center justify-center text-4xl">
                👓
              </div>
              <h3 className="font-semibold text-gray-900 group-hover:text-accent transition-colors">
                {col.label}
              </h3>
              <p className="mt-1 text-sm text-gray-500">{col.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Gender entry points */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Por género</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(["women", "men", "unisex"] as const).map((gender) => {
              const labels = { women: "Para mujer", men: "Para hombre", unisex: "Unisex" };
              const emojis = { women: "👩", men: "👨", unisex: "🧑" };
              return (
                <Link
                  key={gender}
                  href={`/glasses?gender=${gender}`}
                  className="group flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-5 hover:border-accent/30 hover:shadow-sm transition-all"
                >
                  <span className="text-3xl">{emojis[gender]}</span>
                  <span className="font-semibold text-gray-900 group-hover:text-accent transition-colors">
                    {labels[gender]}
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
