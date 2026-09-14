import { alpha, createTheme } from "@mui/material/styles";

export const nexoraTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#2563eb",
      light: "#60a5fa",
      dark: "#1d4ed8",
      contrastText: "#fff",
    },
    secondary: {
      main: "#64748b",
      light: "#94a3b8",
      dark: "#334155",
      contrastText: "#fff",
    },
    success: {
      main: "#059669",
      light: "#34d399",
      dark: "#047857",
      contrastText: "#fff",
    },
    error: {
      main: "#e11d48",
      light: "#fb7185",
      dark: "#be123c",
      contrastText: "#fff",
    },
    warning: {
      main: "#d97706",
      light: "#fbbf24",
      dark: "#b45309",
      contrastText: "#fff",
    },
    info: {
      main: "#0891b2",
      light: "#22d3ee",
      dark: "#0e7490",
      contrastText: "#fff",
    },
    background: { default: "#f6f9ff", paper: "#ffffff" },
    text: { primary: "#0f172a", secondary: "#64748b" },
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    button: { fontWeight: 800, textTransform: "none", letterSpacing: 0 },
    h1: { fontWeight: 900, letterSpacing: "-0.035em" },
    h2: { fontWeight: 900, letterSpacing: "-0.025em" },
    h3: { fontWeight: 900, letterSpacing: "-0.02em" },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: "#f6f9ff", color: "#0f172a" },
        "::selection": { background: alpha("#2563eb", 0.2) },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, size: "large" },
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 14,
          paddingInline: 20,
          transition:
            "transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease",
          "&:hover": {
            transform: "translateY(-2px)",
            boxShadow: "0 12px 28px rgba(37,99,235,.18)",
          },
          "&:active": { transform: "translateY(0) scale(.98)" },
          "&.Mui-disabled": { transform: "none" },
        },
        containedPrimary: {
          backgroundImage: "linear-gradient(135deg,#2563eb,#4f46e5)",
        },
        containedSuccess: {
          backgroundImage: "linear-gradient(135deg,#059669,#0d9488)",
        },
        containedError: {
          backgroundImage: "linear-gradient(135deg,#e11d48,#ef4444)",
        },
        containedSecondary: {
          backgroundImage: "linear-gradient(135deg,#64748b,#475569)",
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          transition: "transform 180ms ease, background-color 180ms ease",
          "&:hover": { transform: "translateY(-2px) scale(1.04)" },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid rgba(255,255,255,.9)",
          borderRadius: 24,
          boxShadow: "0 18px 55px rgba(51,65,85,.10)",
          backgroundImage:
            "linear-gradient(145deg,rgba(255,255,255,.98),rgba(248,250,252,.92))",
        },
      },
    },
    MuiPaper: {
      styleOverrides: { rounded: { borderRadius: 22 } },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 24,
          boxShadow: "0 30px 100px rgba(15,23,42,.25)",
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontWeight: 900, padding: "24px 24px 12px" } },
    },
    MuiDialogActions: { styleOverrides: { root: { gap: 10, padding: 24 } } },
    MuiTextField: { defaultProps: { variant: "outlined", fullWidth: true } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          background: "rgba(255,255,255,.86)",
          transition: "box-shadow 180ms ease",
          "&.Mui-focused": { boxShadow: `0 0 0 4px ${alpha("#2563eb", 0.12)}` },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 16, fontWeight: 650 },
        icon: { alignItems: "center" },
      },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 10, fontWeight: 800 } },
    },
    MuiSkeleton: {
      defaultProps: { animation: "wave" },
      styleOverrides: {
        root: { borderRadius: 18, backgroundColor: alpha("#94a3b8", 0.16) },
      },
    },
    MuiCircularProgress: { defaultProps: { thickness: 5 } },
    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: { tooltip: { borderRadius: 10, fontWeight: 700 } },
    },
  },
});
