export function currentPath(): string {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path;
}
