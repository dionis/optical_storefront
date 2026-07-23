import Link from "next/link";
import type { Metadata } from "next";

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: "¡Pedido confirmado!", robots: { index: false } };
}

export default async function OrderConfirmedPage({ params }: Params) {
  const { id } = await params;

  return (
    <main className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="mb-6 flex justify-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-4xl">
          ✅
        </span>
      </div>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">
        ¡Pedido confirmado!
      </h1>
      <p className="text-gray-500 mb-2">
        Número de pedido:{" "}
        <span className="font-mono font-semibold text-gray-900">{id}</span>
      </p>
      <p className="text-gray-500 mb-8">
        Recibirás un correo de confirmación en breve. Tu pedido será fabricado
        con los lentes que seleccionaste.
      </p>

      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 text-sm text-left space-y-2 mb-8">
        <p className="font-semibold text-gray-700">¿Qué sigue?</p>
        <ol className="space-y-1.5 text-gray-500 list-decimal list-inside">
          <li>Revisamos tu receta (si la enviaste) en las próximas horas.</li>
          <li>Tus lentes se fabrican en 5–7 días hábiles.</li>
          <li>El envío tarda 2–4 días adicionales.</li>
          <li>
            Te notificamos por correo en cada paso con número de guía.
          </li>
        </ol>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href="/glasses"
          className="rounded-xl border border-gray-200 px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Seguir comprando
        </Link>
      </div>
    </main>
  );
}
