/**
 * Broker badge colour palettes.
 * Light: soft tinted backgrounds on white.
 * Dark:  semi-transparent deep backgrounds on near-black, bright text.
 */

export const BROKER_PALETTE_LIGHT = [
  "bg-violet-50  text-violet-700  border-violet-200",
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-sky-50     text-sky-700     border-sky-200",
  "bg-rose-50    text-rose-700    border-rose-200",
  "bg-amber-50   text-amber-700   border-amber-200",
  "bg-teal-50    text-teal-700    border-teal-200",
];

export const BROKER_PALETTE_DARK = [
  "bg-violet-950/60  text-violet-300  border-violet-700",
  "bg-emerald-950/60 text-emerald-300 border-emerald-700",
  "bg-sky-950/60     text-sky-300     border-sky-700",
  "bg-rose-950/60    text-rose-300    border-rose-700",
  "bg-amber-950/60   text-amber-300   border-amber-700",
  "bg-teal-950/60    text-teal-300    border-teal-700",
];

/** Returns the palette appropriate for the current theme. */
export function getBrokerPalette(theme: "light" | "dark"): string[] {
  return theme === "dark" ? BROKER_PALETTE_DARK : BROKER_PALETTE_LIGHT;
}
