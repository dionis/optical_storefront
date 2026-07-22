import { useState } from "react";
import { useCart } from "./CartContext.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

export default function CaseCard({ item, compact = false }) {
  const { addItem } = useCart();
  const { t } = useLang();
  const [added, setAdded] = useState(false);

  const add = () => {
    addItem({ sku: item.sku, name: item.name, total: item.price, isCase: true });
    setAdded(true);
    setTimeout(() => setAdded(false), 1400);
  };

  return (
    <div className={`case-card ${compact ? "compact" : ""}`}>
      <div className="case-media">
        <img src={item.image} alt={item.name} loading="lazy"
             onError={(e) => { e.currentTarget.style.opacity = 0.25; }} />
      </div>
      <div className="case-body">
        <div className="case-name">{item.name}</div>
        {item.material && <div className="case-mat">{item.material}</div>}
        <div className="case-row">
          <span className="case-price">${item.price.toFixed(2)}</span>
          <button className={`case-add ${added ? "done" : ""}`} onClick={add}>
            {added ? "✓ " + t("case.added") : "+ " + t("case.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
