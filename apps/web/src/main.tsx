import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { CssBaseline, ThemeProvider } from "@mui/material";
import App from "./app/App";
import { AuthProvider } from "./features/auth/AuthProvider";
import { SubscriptionProvider } from "./features/subscription/SubscriptionProvider";
import { ToastProvider } from "./features/toast/ToastProvider";
import "./styles/index.css";
import { nexoraTheme } from "./theme/nexoraTheme";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={nexoraTheme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <SubscriptionProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </SubscriptionProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
