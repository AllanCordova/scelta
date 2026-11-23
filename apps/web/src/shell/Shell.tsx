import { AdminAccessCodes } from "../admin/AdminAccessCodes";
import { AdminHub } from "../admin/AdminHub";
import { AdminLogs } from "../admin/AdminLogs";
import { AdminMembers } from "../admin/AdminMembers";
import { AdminProfile } from "../admin/AdminProfile";
import { AdminRoomDetail } from "../admin/AdminRoomDetail";
import { AdminRooms } from "../admin/AdminRooms";
import { AdminTelao } from "../admin/AdminTelao";
import { LoginPage } from "../auth/LoginPage";
import { useAuth } from "../auth/AuthProvider";
import { EnterCodePage } from "../join/EnterCodePage";
import { JoinRoom } from "../join/JoinRoom";
import { joinTargetFromPath } from "../join/path";
import { AccountPage } from "./AccountPage";
import { Header } from "./Header";
import { adminRoomIdFromPath, telaoRoomIdFromPath } from "./paths";
import { TabBar } from "./TabBar";

export function Shell() {
  const pathname = window.location.pathname;
  const page = pageFor(pathname);
  const joinTarget = page === "join" ? joinTargetFromPath(pathname) : null;
  const adminRoomId = page === "admin-room-detail" ? adminRoomIdFromPath(pathname) : null;
  const telaoRoomId = page === "telao" ? telaoRoomIdFromPath(pathname) : null;

  if (page === "telao" && telaoRoomId) {
    return (
      <div className="telao-frame">
        <AdminGate view="telao" roomId={telaoRoomId} />
      </div>
    );
  }

  return (
    <div className="app-frame">
      <Header />
      <div className="shell">
        <main className="content">
          {page === "home" ? <RootLanding /> : null}
          {page === "login" ? <LoginPage /> : null}
          {page === "admin" ? <AdminGate view="hub" /> : null}
          {page === "admin-rooms" ? <AdminGate view="rooms" /> : null}
          {page === "admin-room-detail" && adminRoomId ? (
            <AdminGate view="room-detail" roomId={adminRoomId} />
          ) : null}
          {page === "admin-codes" ? <AdminGate view="codes" /> : null}
          {page === "admin-members" ? <AdminGate view="members" /> : null}
          {page === "admin-logs" ? <AdminGate view="logs" /> : null}
          {page === "admin-profile" ? <AdminGate view="profile" /> : null}
          {page === "account" ? <AccountPage /> : null}
          {page === "join" && joinTarget?.mode === "token" ? (
            <JoinRoom token={joinTarget.token} />
          ) : null}
          {page === "join" && joinTarget?.mode === "shortCode" ? (
            <JoinRoom shortCode={joinTarget.shortCode} />
          ) : null}
        </main>
      </div>
      <TabBar />
    </div>
  );
}

function RootLanding() {
  const auth = useAuth();
  if (auth.status === "loading") {
    return <p className="panel">Carregando…</p>;
  }
  if (auth.status === "authenticated") {
    return auth.user.role === "admin" ? <AdminHub /> : <AccountPage />;
  }
  return (
    <div className="join-page">
      <EnterCodePage />
      <LoginPage />
    </div>
  );
}

function AdminGate({
  view,
  roomId,
}: {
  view: "hub" | "rooms" | "members" | "codes" | "logs" | "room-detail" | "profile" | "telao";
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
          : view === "logs"
            ? "Logs de Integridade"
            : view === "profile"
              ? "Perfil"
              : view === "telao"
                ? "Telão"
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
  if (view === "logs") {
    return <AdminLogs />;
  }
  if (view === "profile") {
    return <AdminProfile />;
  }
  if (view === "room-detail" && roomId) {
    return <AdminRoomDetail roomId={roomId} />;
  }
  if (view === "telao" && roomId) {
    return <AdminTelao roomId={roomId} />;
  }
  return <AdminRooms />;
}

/**
 * Join (`/join/...`, `/s/...`) and future ballot pages stay on the public branch.
 * Only `/admin` asks for an admin session.
 */
function pageFor(
  pathname: string,
):
  | "home"
  | "login"
  | "admin"
  | "admin-rooms"
  | "admin-room-detail"
  | "admin-codes"
  | "admin-members"
  | "admin-logs"
  | "admin-profile"
  | "account"
  | "join"
  | "telao" {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/entrar" || path === "/login") {
    return "login";
  }
  if (telaoRoomIdFromPath(path)) {
    return "telao";
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
  if (path === "/admin/logs") {
    return "admin-logs";
  }
  if (path === "/admin/perfil") {
    return "admin-profile";
  }
  if (path === "/conta") {
    return "account";
  }
  if (joinTargetFromPath(path)) {
    return "join";
  }
  return "home";
}
