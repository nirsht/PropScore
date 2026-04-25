"use client";

import * as React from "react";
import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { CssBaseline, GlobalStyles, ThemeProvider } from "@mui/material";
import theme from "@/theme/theme";
import { TRPCProvider } from "@/lib/trpc/client";

const mapLibreDarkOverrides = (
  <GlobalStyles
    styles={{
      ".maplibregl-popup-content": {
        background: "var(--mui-palette-background-paper) !important",
        color: "var(--mui-palette-text-primary)",
        borderRadius: 10,
        padding: "12px 14px !important",
        border: "1px solid var(--mui-palette-divider)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
      },
      ".maplibregl-popup-tip": {
        borderTopColor: "var(--mui-palette-background-paper) !important",
        borderBottomColor: "var(--mui-palette-background-paper) !important",
      },
      ".maplibregl-popup-close-button": {
        color: "var(--mui-palette-text-secondary)",
        fontSize: 18,
        padding: "0 8px",
      },
      ".maplibregl-ctrl-group": {
        background: "var(--mui-palette-background-paper) !important",
        border: "1px solid var(--mui-palette-divider)",
      },
      ".maplibregl-ctrl-group button": {
        backgroundColor: "transparent !important",
      },
      ".maplibregl-ctrl-group button .maplibregl-ctrl-icon": {
        filter: "invert(0.85)",
      },
      ".maplibregl-ctrl-attrib": {
        background: "rgba(0,0,0,0.4) !important",
        color: "var(--mui-palette-text-secondary)",
      },
      ".maplibregl-ctrl-attrib a": {
        color: "var(--mui-palette-text-secondary)",
      },
    }}
  />
);

export function Providers({
  children,
  session,
}: {
  children: React.ReactNode;
  session?: Session | null;
}) {
  return (
    // refetchInterval=0 + refetchOnWindowFocus=false eliminates the chatty
    // /api/auth/session polling that triggers React 19 dev-mode warnings on
    // hot reload. The server-rendered layout already passes a fresh session.
    <SessionProvider session={session ?? undefined} refetchInterval={0} refetchOnWindowFocus={false}>
      <AppRouterCacheProvider options={{ enableCssLayer: true }}>
        <ThemeProvider theme={theme}>
          <CssBaseline enableColorScheme />
          {mapLibreDarkOverrides}
          <TRPCProvider>{children}</TRPCProvider>
        </ThemeProvider>
      </AppRouterCacheProvider>
    </SessionProvider>
  );
}
