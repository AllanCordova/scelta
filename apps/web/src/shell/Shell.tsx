import { AdminRooms } from "../admin/AdminRooms";
import { LoginPage } from "../auth/LoginPage";
import { RegisterPage } from "../auth/RegisterPage";
import { useAuth } from "../auth/AuthProvider";
import { JoinRoom } from "../join/JoinRoom";
import { joinTokenFromPath } from "../join/path";
import { AccountPage } from "./AccountPage";
import { Header } from "./Header";
import { Home } from "./Home";
import { TabBar } from "./TabBar";

export function Shell() {
  const pathname = window.location.pathname;
  const page = pageFor(pathname);
  const joinToken = page === "join" ? joinTokenFromPath(pathname) : null;

  return (
    <div className="app-frame">
      <Header />
      <div className="shell">
        <main className="content">
          {page === "home" ? <Home /> : null}
          {page === "login" ? <LoginPage /> : null}
          {page === "register" ? <RegisterPage /> : null}
          {page === "admin" ? <AdminGate /> : null}
          {page === "account" ? <AccountPage /> : null}
          {page === "join" && joinToken ? <JoinRoom token={joinToken} /> : null}
        </main>
      </div>
      <TabBar />
    </div>
  );
}

function AdminGate() {
  const auth = useAuth();
  if (auth.status === "loading") {
    return <p className="panel">Carregando…</p>;
  }
  if (auth.status !== "authenticated") {
    return <LoginPage />;
  }
  if (auth.user.role !== "admin") {
    return (
      <section className="panel">
        <h2>Salas</h2>
        <p role="alert">Esta área é só para administradores.</p>
      </section>
    );
  }
  return <AdminRooms />;
}

/**
 * Join (`/join/...`) and future ballot pages stay on the public branch.
 * Only `/admin` asks for an admin session.
 */
function pageFor(pathname: string): "home" | "login" | "register" | "admin" | "account" | "join" {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/entrar") {
    return "login";
  }
  if (path === "/cadastrar") {
    return "register";
  }
  if (path === "/admin") {
    return "admin";
  }
  if (path === "/conta") {
    return "account";
  }
  if (joinTokenFromPath(path)) {
    return "join";
  }
  return "home";
}
