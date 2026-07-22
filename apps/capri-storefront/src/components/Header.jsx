import { Link, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useCart } from "./CartContext.jsx";

export default function Header() {
  const { count } = useCart();
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const submit = (e) => {
    e.preventDefault();
    navigate(`/catalogo?q=${encodeURIComponent(q)}`);
  };

  return (
    <header className="header">
      <div className="header-top">
        <span>Envío gratis en pedidos superiores a $59 · Garantía de 30 días</span>
      </div>
      <div className="header-main">
        <Link to="/" className="logo">
          <span className="logo-mark">CAPRI</span>
          <span className="logo-sub">ÓPTICA</span>
        </Link>

        <nav className="nav">
          <NavLink to="/catalogo">Espejuelos</NavLink>
          <NavLink to="/catalogo?age=Niños">Infantiles</NavLink>
          <NavLink to="/#marcas">Marcas</NavLink>
        </nav>

        <form className="search" onSubmit={submit}>
          <input
            type="text"
            placeholder="Buscar por modelo o marca…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" aria-label="Buscar">⌕</button>
        </form>

        <div className="header-actions">
          <button className="icon-btn" title="Favoritos">♡</button>
          <button className="icon-btn cart" title="Carrito">
            🛒{count > 0 && <span className="badge">{count}</span>}
          </button>
        </div>
      </div>
    </header>
  );
}
