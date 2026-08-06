import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { purgeStaleStorage } from "./lib/storageVersion.js";
import "./styles/index.css";

// Antes de renderizar: si el formato de algún dato guardado cambió en un deploy,
// las cachés viejas se borran solas aquí. Tiene que correr antes que cualquier
// módulo las lea (LanguageContext, CartContext y priceStore leen al importarse).
purgeStaleStorage();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
