import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { T, tv } from "./translations.js";

const LangContext = createContext(null);

function initialLang() {
  try {
    const saved = localStorage.getItem("oer_lang");
    if (saved === "es" || saved === "en") return saved;
    const nav = (navigator.language || "es").slice(0, 2);
    return nav === "en" ? "en" : "es";
  } catch {
    return "es";
  }
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(initialLang);

  useEffect(() => {
    try { localStorage.setItem("oer_lang", lang); } catch {}
    document.documentElement.lang = lang;
  }, [lang]);

  // `params` fills `{name}` placeholders — needed for messages whose values come
  // from the backend (prescription ranges, measured values) rather than the copy.
  const t = useCallback(
    (key, params) => {
      const s = T[lang][key] ?? T.es[key] ?? key;
      if (!params) return s;
      return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
    },
    [lang]
  );
  const translateValue = useCallback((v) => tv(v, lang), [lang]);
  const toggle = useCallback(() => setLang((l) => (l === "es" ? "en" : "es")), []);

  return (
    <LangContext.Provider value={{ lang, setLang, toggle, t, tv: translateValue }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
