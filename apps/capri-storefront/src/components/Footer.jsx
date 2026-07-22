import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-cols">
        <div>
          <h4>Capri Óptica</h4>
          <p>Espejuelos de marca online. Monturas de DiCaprio, Flexure, Millennial, Peachtree, Four You y Trendy.</p>
        </div>
        <div>
          <h4>Comprar</h4>
          <Link to="/catalogo">Todos los espejuelos</Link>
          <Link to="/catalogo?age=Niños">Infantiles</Link>
          <Link to="/#marcas">Marcas</Link>
        </div>
        <div>
          <h4>Ayuda</h4>
          <a href="#">Cómo elegir tu montura</a>
          <a href="#">Guía de recetas</a>
          <a href="#">Envíos y devoluciones</a>
        </div>
        <div>
          <h4>Servicio</h4>
          <a href="#">Probador virtual (AR)</a>
          <a href="#">Sube tu receta</a>
          <a href="#">Contacto</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Capri Óptica · Imágenes cortesía de caprioptics.com</span>
      </div>
    </footer>
  );
}
