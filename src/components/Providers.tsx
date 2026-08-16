"use client";

import { useState, type ReactNode } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntlProvider } from "react-intl";
import { getMessages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/types";

const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: "dark",
    primary: { main: "#ff4655" },
    background: { default: "#090b10", paper: "#11151d" },
    text: { primary: "#f4f6f8", secondary: "#9aa5b5" },
  },
  typography: {
    fontFamily: "Arial, Helvetica, sans-serif",
    h1: { fontWeight: 800, letterSpacing: "-0.04em" },
    h2: { fontWeight: 750, letterSpacing: "-0.03em" },
    h3: { fontWeight: 700 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCard: { styleOverrides: { root: { border: "1px solid rgba(255,255,255,.08)", backgroundImage: "none" } } },
    MuiButton: { defaultProps: { disableElevation: true } },
  },
});

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <IntlProvider locale={locale} messages={getMessages(locale)}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </IntlProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
