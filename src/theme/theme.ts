"use client";

import { createTheme, responsiveFontSizes } from "@mui/material/styles";

const accent = "#7c5cff";
const accentMuted = "#5f47cc";

let theme = createTheme({
  cssVariables: {
    colorSchemeSelector: "data-mui-color-scheme",
  },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: accent, dark: accentMuted, contrastText: "#fff" },
        secondary: { main: "#0fb27d" },
        background: { default: "#fafafa", paper: "#ffffff" },
        text: { primary: "#0a0a0a", secondary: "#5b5b5b" },
        divider: "rgba(0,0,0,0.08)",
      },
    },
    dark: {
      palette: {
        primary: { main: accent, dark: accentMuted, contrastText: "#fff" },
        secondary: { main: "#23d29a" },
        background: { default: "#0a0a0c", paper: "#121216" },
        text: { primary: "#f5f5f5", secondary: "#a8a8b2" },
        divider: "rgba(255,255,255,0.08)",
      },
    },
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    h1: { fontWeight: 700, letterSpacing: "-0.02em" },
    h2: { fontWeight: 700, letterSpacing: "-0.02em" },
    h3: { fontWeight: 700, letterSpacing: "-0.01em" },
    h4: { fontWeight: 600, letterSpacing: "-0.01em" },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 500 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 10 } },
    },
    MuiTextField: { defaultProps: { size: "small", fullWidth: true } },
    MuiChip: { styleOverrides: { root: { borderRadius: 8 } } },
  },
});

theme = responsiveFontSizes(theme);

export default theme;
