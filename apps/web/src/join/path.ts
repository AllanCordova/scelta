export function joinTokenFromPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const match = /^\/join\/([^/]+)$/.exec(path);
  const raw = match?.[1];
  if (!raw) {
    return null;
  }

  try {
    const token = decodeURIComponent(raw);
    return token.length > 0 ? token : null;
  } catch {
    return raw;
  }
}
