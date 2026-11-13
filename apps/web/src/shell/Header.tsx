import { logout } from "../auth/auth-api";
import { useAuth } from "../auth/AuthProvider";
import { currentPath } from "./paths";
import { initialsFromName } from "./ImageDropzone";
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
        {auth.status === "authenticated" && auth.user.role === "admin" ? (
          <>
            <a
              className="nav-link"
              href="/admin/salas"
              aria-current={
                path === "/admin/salas" || path.startsWith("/admin/salas/") ? "page" : undefined
              }
            >
              Salas
            </a>
            <a
              className="nav-link"
              href="/admin"
              aria-current={
                path === "/admin" || path === "/admin/codigos" || path === "/admin/membros"
                  ? "page"
                  : undefined
              }
            >
              Admin
            </a>
          </>
        ) : null}
      </nav>
      <div className="account">
        <ThemeToggle />
        {auth.status === "authenticated" ? (
          auth.user.role === "admin" ? (
            <a
              href="/admin/perfil"
              className="account-identity account-identity-link"
              title={`${auth.user.name} — Editar perfil`}
            >
              {auth.user.photoUrl ? (
                <img src={auth.user.photoUrl} alt="" className="header-avatar-img" />
              ) : (
                <span className="header-avatar-initials" aria-hidden="true">
                  {initialsFromName(auth.user.name)}
                </span>
              )}
              <span className="account-name">{auth.user.name}</span>
            </a>
          ) : (
            <span className="account-identity" title={auth.user.name}>
              <UserIcon />
              <span className="account-name">{auth.user.name}</span>
            </span>
          )
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
            <button type="button" className="ghost" onClick={() => window.location.assign("/entrar")}>
              Entrar
            </button>
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
