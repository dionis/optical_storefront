import { initPerfHints } from "./lib/seo.js";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { purgeStaleStorage } from "./lib/storageVersion.js";
import { loadLiveFrameMedia } from "./data/frameMediaLive.js";
import { applyCachedBrand, refreshBrand } from "./config/brandRuntime.js";
import { MEDUSA_URL, MEDUSA_PUBLISHABLE_KEY } from "./data/medusa.js";
import "./styles/tokens.css";
import "./styles/index.css";

// Antes de renderizar: si el formato de algún dato guardado cambió en un deploy,
// las cachés viejas se borran solas aquí. Tiene que correr antes que cualquier
// módulo las lea (LanguageContext, CartContext y priceStore leen al importarse).
purgeStaleStorage();

// La marca guardada por el dueño en el panel: la última conocida antes del primer
// pintado (sin parpadeo) y la actual en segundo plano.
applyCachedBrand();
refreshBrand({ url: MEDUSA_URL, publishableKey: MEDUSA_PUBLISHABLE_KEY });

// Vistas generadas más nuevas que el build: se piden ya, en paralelo al primer
// render, en vez de esperar a que una ficha las necesite.
loadLiveFrameMedia();

// Preconexiones al backend y al host de imágenes (R2): TLS abierto antes de la
// primera petición — el catálogo y las fichas pintan antes.
initPerfHints();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
