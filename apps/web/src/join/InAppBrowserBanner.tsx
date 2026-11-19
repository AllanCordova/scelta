import { useEffect, useRef, useState } from "react";

export type InAppBrowserBannerProps = {
  appName: string | null;
  urlToCopy: string;
  onContinueAnyway?: () => void;
};

const COPIED_RESET_MS = 2500;

async function copyTextWithFallback(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy execCommand fallback when Clipboard API is blocked in WebViews.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function InAppBrowserBanner({
  appName,
  urlToCopy,
  onContinueAnyway,
}: InAppBrowserBannerProps) {
  const [hasCopied, setHasCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleCopyLink() {
    const ok = await copyTextWithFallback(urlToCopy);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    if (ok) {
      setCopyFailed(false);
      setHasCopied(true);
      resetTimerRef.current = window.setTimeout(() => {
        setHasCopied(false);
        resetTimerRef.current = null;
      }, COPIED_RESET_MS);
      return;
    }

    setHasCopied(false);
    setCopyFailed(true);
  }

  const sourceLabel = appName ? `pelo navegador interno (${appName})` : "em um navegador integrado (WhatsApp, Instagram ou câmera)";

  return (
    <section
      className="panel"
      data-testid="in-app-browser-warning"
      role="region"
      aria-labelledby="in-app-browser-warning-title"
      style={{
        borderColor: "var(--brand)",
        background: "var(--surface-raised)",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <h2 id="in-app-browser-warning-title" style={{ margin: 0, fontSize: "1rem" }}>
          Abra este link no Chrome ou no Safari
        </h2>
        <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.45 }}>
          Você abriu este convite {sourceLabel}. Se você entrar por aqui e trocar de navegador
          depois, seu código de acesso pode ficar bloqueado neste aparelho.
        </p>
        <p className="muted" style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.4 }}>
          Copie o link abaixo e cole no Chrome ou no Safari antes de informar seu código.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <button
          type="button"
          data-testid="copy-in-app-link"
          onClick={() => void handleCopyLink()}
        >
          {hasCopied ? "Link copiado!" : "Copiar link"}
        </button>

        {onContinueAnyway ? (
          <button type="button" className="ghost" onClick={onContinueAnyway}>
            Continuar mesmo assim
          </button>
        ) : null}
      </div>

      <span className="sr-only" aria-live="polite">
        {hasCopied
          ? "Link copiado para a área de transferência."
          : copyFailed
            ? "Não foi possível copiar automaticamente. Copie o endereço da barra do navegador."
            : ""}
      </span>

      {copyFailed ? (
        <p className="form-error" role="alert" style={{ fontSize: "0.85rem" }}>
          Não foi possível copiar automaticamente. Copie o link pela opção &ldquo;Abrir no navegador&rdquo; do aplicativo.
        </p>
      ) : null}
    </section>
  );
}
