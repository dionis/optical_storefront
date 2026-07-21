interface Params {
  params: Promise<{ id: string }>;
}

export default async function OrderConfirmedPage({ params }: Params) {
  const { id } = await params;

  return (
    <main className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="text-5xl mb-6">✅</div>
      <h1 className="text-3xl font-bold mb-4">¡Pedido confirmado!</h1>
      <p className="text-gray-500 mb-2">
        Número de pedido:{" "}
        <span className="font-mono font-semibold text-gray-900">{id}</span>
      </p>
      <p className="text-gray-500">
        Recibirás un correo de confirmación en breve.
      </p>
    </main>
  );
}
