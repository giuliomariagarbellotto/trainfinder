export const prefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

/** Colori dei treni per classe di ritardo; devono restare leggibili su entrambe le basi. */
export const DELAY_COLORS = {
  light: { unknown: "#5b6b7f", ontime: "#16833a", minor: "#b98900", late: "#d4570f", verylate: "#c8203a" },
  dark: { unknown: "#9fb0c4", ontime: "#3ccf6a", minor: "#f2c12e", late: "#ff8a3d", verylate: "#ff5470" },
};

export const MAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

export const ACCENT = { light: "#1f6feb", dark: "#58a6ff" };
