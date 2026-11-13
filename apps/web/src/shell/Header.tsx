import { logout } from "../auth/auth-api";
import { useAuth } from "../auth/AuthProvider";
import { currentPath } from "./paths";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  const auth = useAuth();
  const path = currentPath();

  async function handleLogout() {
    await logout();
    window.location.assign("/");
  }

  return (
    <header className="topbar">
      <a className="platform-name" href="/">
        Scelta
      </a>
      <nav className="topbar-nav" aria-label="Navegação">
        <a className="nav-link" href="/" aria-current={path === "/" ? "page" : undefined}>
          Início
        </a>
        <a className="nav-link" href="/admin" aria-current={path === "/admin" ? "page" : undefined}>
          Salas
        </a>
      </nav>
      <div className="account">
        <ThemeToggle />
        {auth.status === "authenticated" ? (
          <span className="account-identity" title={auth.user.name}>
            <UserIcon />
            <span className="account-name">{auth.user.name}</span>
          </span>
        ) : null}
        <div className="account-actions">
          {auth.status === "authenticated" ? (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void handleLogout().catch(() => undefined);
              }}
            >
              Sair
            </button>
          ) : null}
          {auth.status === "anonymous" ? (
            <>
              <button type="button" className="ghost" onClick={() => window.location.assign("/entrar")}>
                Entrar
              </button>
              <button type="button" onClick={() => window.location.assign("/cadastrar")}>
                Cadastrar
              </button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function UserIcon() {
  return (
    <svg className="account-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z" />
    </svg>
  );
}
