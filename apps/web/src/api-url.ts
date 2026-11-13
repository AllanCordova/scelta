export function apiUrl(path: string): string {
  const configured = import.meta.env.VITE_API_URL;
  const base = typeof configured === "string" ? configured.replace(/\/$/, "") : "";
  return `${base}${path}`;
}

export function configuredApiUrl(): string {
  const configured = import.meta.env.VITE_API_URL;
  return typeof configured === "string" ? configured : "";
}
