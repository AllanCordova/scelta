import { AdminAccessCodes } from "../admin/AdminAccessCodes";
import { AdminHub } from "../admin/AdminHub";
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
          {page === "admin" ? <AdminGate view="hub" /> : null}
          {page === "admin-rooms" ? <AdminGate view="rooms" /> : null}
          {page === "admin-room-detail" && adminRoomId ? (
            <AdminGate view="room-detail" roomId={adminRoomId} />
          ) : null}
          {page === "admin-codes" ? <AdminGate view="codes" /> : null}
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
  view: "hub" | "rooms" | "members" | "codes" | "room-detail";
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
    const heading =
      view === "members"
        ? "Membros"
        : view === "codes"
          ? "Códigos de Acesso"
          : view === "hub"
            ? "Administração"
            : "Salas";
    return (
      <section className="panel">
        <h2>{heading}</h2>
        <p role="alert">Esta área é só para administradores.</p>
      </section>
    );
  }
  if (view === "hub") {
    return <AdminHub />;
  }
  if (view === "codes") {
    return <AdminAccessCodes />;
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
):
  | "home"
  | "login"
  | "register"
  | "admin"
  | "admin-rooms"
  | "admin-room-detail"
  | "admin-codes"
  | "admin-members"
  | "account"
  | "join" {
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
  if (path === "/admin/salas") {
    return "admin-rooms";
  }
  if (adminRoomIdFromPath(path)) {
    return "admin-room-detail";
  }
  if (path === "/admin/codigos") {
    return "admin-codes";
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
