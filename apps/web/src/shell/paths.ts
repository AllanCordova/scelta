export function currentPath(): string {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path;
}

export function adminRoomIdFromPath(pathname: string): string | null {
  const match = /^\/admin\/salas\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
