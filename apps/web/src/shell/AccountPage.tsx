import { logout } from "../auth/auth-api";
import { useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";

export function AccountPage() {
  const auth = useAuth();

  async function handleLogout() {
    await logout();
    window.location.assign("/");
  }

  if (auth.status === "loading") {
    return <p className="panel">Carregando…</p>;
  }

  if (auth.status !== "authenticated") {
    return <LoginPage />;
  }

  return (
    <section className="panel" aria-labelledby="account-heading">
      <h2 id="account-heading">Conta</h2>
      <p className="account-page-name">{auth.user.name}</p>
      <p className="muted">{auth.user.email}</p>
      <button
        type="button"
        onClick={() => {
          void handleLogout().catch(() => undefined);
        }}
      >
        Sair
      </button>
    </section>
  );
}
