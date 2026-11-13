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
      <TabLink href="/admin" label="Salas" current={path === "/admin"}>
        <RoomsIcon />
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

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z" />
    </svg>
  );
}
