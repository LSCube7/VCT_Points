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
  palette: { mode: "light", primary: { main: "#1976d2" }, secondary: { main: "#7b1fa2" }, background: { default: "#f5f7fb", paper: "#ffffff" }, text: { primary: "#17202a", secondary: "#5f6b7a" } },
  typography: {
    fontFamily: "Roboto, Arial, Helvetica, sans-serif",
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 700 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiCard: { styleOverrides: { root: { border: "1px solid #e2e8f0", backgroundImage: "none" } } },
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
