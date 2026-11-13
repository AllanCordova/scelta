import { AdminMembers } from "../admin/AdminMembers";
import { AdminRoomDetail } from "../admin/AdminRoomDetail";
import { AdminRooms } from "../admin/AdminRooms";
import { LoginPage } from "../auth/LoginPage";
import { RegisterPage } from "../auth/RegisterPage";
import { useAuth } from "../auth/AuthProvider";
import { JoinRoom } from "../join/JoinRoom";
import { joinTokenFromPath } from "../join/path";
import { AccountPage } from "./AccountPage";
import { Header } from "./Header";
import { Home } from "./Home";
import { adminRoomIdFromPath } from "./paths";
import { TabBar } from "./TabBar";

export function Shell() {
  const pathname = window.location.pathname;
  const page = pageFor(pathname);
  const joinToken = page === "join" ? joinTokenFromPath(pathname) : null;
  const adminRoomId = page === "admin-room-detail" ? adminRoomIdFromPath(pathname) : null;

  return (
    <div className="app-frame">
      <Header />
      <div className="shell">
        <main className="content">
          {page === "home" ? <Home /> : null}
          {page === "login" ? <LoginPage /> : null}
          {page === "register" ? <RegisterPage /> : null}
          {page === "admin" ? <AdminGate view="rooms" /> : null}
          {page === "admin-room-detail" && adminRoomId ? (
            <AdminGate view="room-detail" roomId={adminRoomId} />
          ) : null}
          {page === "admin-members" ? <AdminGate view="members" /> : null}
          {page === "account" ? <AccountPage /> : null}
          {page === "join" && joinToken ? <JoinRoom token={joinToken} /> : null}
        </main>
      </div>
      <TabBar />
    </div>
  );
}

function AdminGate({
  view,
  roomId,
}: {
  view: "rooms" | "members" | "room-detail";
  roomId?: string;
}) {
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
        <h2>{view === "members" ? "Membros" : "Salas"}</h2>
        <p role="alert">Esta área é só para administradores.</p>
      </section>
    );
  }
  if (view === "members") {
    return <AdminMembers />;
  }
  if (view === "room-detail" && roomId) {
    return <AdminRoomDetail roomId={roomId} />;
  }
  return <AdminRooms />;
}

/**
 * Join (`/join/...`) and future ballot pages stay on the public branch.
 * Only `/admin` asks for an admin session.
 */
function pageFor(
  pathname: string,
): "home" | "login" | "register" | "admin" | "admin-room-detail" | "admin-members" | "account" | "join" {
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
  if (adminRoomIdFromPath(path)) {
    return "admin-room-detail";
  }
  if (path === "/admin/membros") {
    return "admin-members";
  }
  if (path === "/conta") {
    return "account";
  }
  if (joinTokenFromPath(path)) {
    return "join";
  }
  return "home";
}
