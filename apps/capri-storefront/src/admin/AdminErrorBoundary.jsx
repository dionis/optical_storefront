// Dónde se usa: AdminShell.jsx, envolviendo el contenido de la pestaña activa.
//
// Por qué existe: un error al PINTAR en React desmonta todo el árbol, y sin una
// barrera el panel entero se queda en blanco — pantalla vacía, sin un mensaje,
// sin forma de volver atrás. Pasó de verdad: una constante usada antes de su
// declaración en PosSale.jsx dejaba la caja en blanco justo al elegir el color
// de la montura, y desde fuera era indistinguible de «se cayó el servidor».
//
// Esta barrera no arregla el fallo: lo acota. La pestaña que revienta enseña un
// aviso en su sitio, con el detalle técnico plegado (para que quien lo reporte
// pueda copiarlo) y un botón para reintentar; la barra lateral, la de filtros y
// el resto del panel siguen vivos, así que se puede cambiar de pestaña y seguir
// trabajando. `key={tab}` en el contenido hace que cambiar de pestaña reintente
// sola, sin recargar el navegador.
//
// Es un componente de clase a propósito: `componentDidCatch` /
// `getDerivedStateFromError` no tienen equivalente en hooks.
import { Component } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";

/** El aviso en sí; separado para poder usar `useLang()` (la clase no puede). */
function CrashNotice({ error, onRetry }) {
  const { t } = useLang();
  return (
    <div className="adm-section adm-crash" role="alert">
      <div className="adm-crash-head">
        <Icon name="alert" size={18} />
        <b>{t("adm.crash.title")}</b>
      </div>
      <p className="adm-sub">{t("adm.crash.body")}</p>
      <button type="button" className="btn-sm primary" onClick={onRetry}>{t("adm.crash.retry")}</button>
      {error && (
        <details className="adm-crash-detail">
          <summary>{t("adm.crash.detail")}</summary>
          <pre>{String(error.stack || error.message || error)}</pre>
        </details>
      )}
    </div>
  );
}

export default class AdminErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // La consola del navegador es lo único que tenemos para diagnosticar un
    // fallo que solo le pasa al dueño en su pantalla: el stack completo y el
    // árbol de componentes van ahí, no a un servicio externo.
    console.error("[admin] la pestaña reventó al pintarse:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return <CrashNotice error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
