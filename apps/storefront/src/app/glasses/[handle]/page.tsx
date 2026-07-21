interface Params {
  params: Promise<{ handle: string }>;
}

export default async function ProductPage({ params }: Params) {
  const { handle } = await params;

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <p className="text-sm text-gray-400 mb-2">
        Página de producto — <code>{handle}</code>
      </p>
      <h1 className="text-3xl font-bold mb-4">Montura</h1>
      {/* Product gallery, color selector, CTA implemented in Phase 3 */}
      <p className="text-gray-400">
        El detalle de producto y el embudo de lentes se implementarán en la
        Fase 3.
      </p>
    </main>
  );
}
