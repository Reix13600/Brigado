import { RoleType } from "../types";

const DARK_COLORS: Record<RoleType, string> = {
  server: "#a3e635",      // lime
  kitchen: "#fb923c",     // orange
  cold: "#60a5fa",        // blue
  dishwasher: "#a78bfa",  // purple
  bar: "#f472b6",         // pink
  chef: "#f87171",        // red
  cleaner: "#2dd4bf",     // teal
  host: "#fbbf24",        // amber
  other: "#94a3b8",       // slate
};

const LIGHT_COLORS: Record<RoleType, string> = {
  server: "#16a34a",      // green-600
  kitchen: "#c2410c",     // orange-700
  cold: "#1d4ed8",        // blue-700
  dishwasher: "#7c3aed",  // purple-600
  bar: "#db2777",         // pink-600
  chef: "#dc2626",        // red-600
  cleaner: "#0d9488",     // teal-600
  host: "#d97706",        // amber-600
  other: "#475569",       // slate-650
};

/** Same role -> color mapping used across Manager and Staff dashboards,
 * so a "server" shift always reads the same color everywhere. */
export function getRoleColor(role: RoleType, theme: "light" | "dark" = "dark"): string {
  return (theme === "light" ? LIGHT_COLORS : DARK_COLORS)[role] ?? DARK_COLORS.other;
}
