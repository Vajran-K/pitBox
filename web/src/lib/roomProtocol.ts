// One source of truth for the room messages: the worker's protocol file.
export * from "../../../rooms/src/protocol";

/** Where the rooms worker lives. Same origin in development (Vite proxies /api). */
export const ROOMS_BASE: string = (import.meta.env.VITE_ROOMS_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export function roomsWsUrl(path: string): string {
  if (ROOMS_BASE) return ROOMS_BASE.replace(/^http/, "ws") + path;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
}
