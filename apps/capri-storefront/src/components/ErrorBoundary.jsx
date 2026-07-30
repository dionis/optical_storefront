import React from "react";

// ─────────────────────────────────────────────────────────────────────────
// ErrorBoundary — red de seguridad global anti-caídas.
//
// React, si un componente lanza una excepción al renderizar, DESMONTA todo el
// árbol y deja la pantalla en blanco. Este límite atrapa ese error, evita la
// pantalla blanca y muestra un aviso amable con un botón para recargar, de modo
// que un dato malformado (un producto sin atributos, un id inexistente, etc.)
// nunca "tumbe" toda la tienda.
//
// Debe envolver la app entera (ver main.jsx). Es un componente de CLASE porque
// los error boundaries de React solo existen como clase (getDerivedStateFromError
// / componentDidCatch no tienen equivalente en hooks).
// ─────────────────────────────────────────────────────────────────────────
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  // Cuando un hijo lanza al renderizar, React llama a esto para pasar a UI de error.
  static getDerivedStateFromError() {
    return { hasError: true };
  }

  // Punto para registrar el error (consola ahora; un servicio tipo Sentry en el futuro).
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] La UI lanzó un error:", error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      // Texto bilingüe mínimo SIN depender de contextos (el error pudo venir de ellos).
      const es = (navigator.language || "es").toLowerCase().startsWith("es");
      return (
        <div style={{
          minHeight: "60vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 14,
          textAlign: "center", padding: 24, fontFamily: "system-ui, sans-serif",
        }}>
          <div style={{ fontSize: 40 }}>👓</div>
          <h2 style={{ margin: 0 }}>{es ? "Algo salió mal" : "Something went wrong"}</h2>
          <p style={{ color: "#666", maxWidth: 420, margin: 0 }}>
            {es
              ? "Tuvimos un problema al mostrar esta parte. Puedes recargar para volver a la tienda."
              : "We hit a problem showing this section. You can reload to return to the store."}
          </p>
          <button
            onClick={() => { window.location.href = "/"; }}
            style={{
              border: "none", background: "#0E5AD0", color: "#fff", fontWeight: 700,
              padding: "11px 22px", borderRadius: 999, cursor: "pointer",
            }}
          >
            {es ? "Volver a la tienda" : "Back to the store"}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
