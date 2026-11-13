import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { currentPath } from "./paths";

export function TabBar() {
  const auth = useAuth();
  const path = currentPath();
  const accountHref = auth.status === "authenticated" ? "/conta" : "/entrar";
  const accountLabel = auth.status === "authenticated" ? "Conta" : "Entrar";

  return (
    <nav className="tabbar" aria-label="Navegação principal">
      <TabLink href="/" label="Início" current={path === "/"}>
        <HomeIcon />
      </TabLink>
      <TabLink
        href="/admin"
        label="Salas"
        current={path === "/admin" || path.startsWith("/admin/salas/")}
      >
        <RoomsIcon />
      </TabLink>
      <TabLink href="/admin/membros" label="Membros" current={path === "/admin/membros"}>
        <MembersIcon />
      </TabLink>
      <TabLink href={accountHref} label={accountLabel} current={path === accountHref}>
        <PersonIcon />
      </TabLink>
    </nav>
  );
}

function TabLink({
  href,
  label,
  current,
  children,
}: {
  href: string;
  label: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <a className="tabbar-item" href={href} aria-current={current ? "page" : undefined}>
      {children}
      <span>{label}</span>
    </a>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function RoomsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z" />
    </svg>
  );
}

function MembersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z" />
    </svg>
  );
}
