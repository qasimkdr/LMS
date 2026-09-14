import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ErrorRoundedIcon from "@mui/icons-material/ErrorRounded";
import InfoRoundedIcon from "@mui/icons-material/InfoRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { Alert, AlertTitle, IconButton, Slide } from "@mui/material";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

export type ToastKind = "success" | "error" | "info" | "warning";
export type ToastInput = { kind: ToastKind; title: string; message?: string };
type ToastItem = ToastInput & { id: number; open: boolean };
const ToastContext = createContext<{
  showToast: (toast: ToastInput) => void;
} | null>(null);

export function emitToast(toast: ToastInput) {
  window.dispatchEvent(
    new CustomEvent<ToastInput>("nexora:toast", { detail: toast }),
  );
}

const icons = {
  success: <CheckCircleRoundedIcon fontSize="inherit" />,
  error: <ErrorRoundedIcon fontSize="inherit" />,
  info: <InfoRoundedIcon fontSize="inherit" />,
  warning: <WarningAmberRoundedIcon fontSize="inherit" />,
};

export function ToastProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, open: false } : item)),
    );
    window.setTimeout(
      () => setItems((current) => current.filter((item) => item.id !== id)),
      300,
    );
  }, []);
  const showToast = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setItems((current) => [
        ...current.slice(-3),
        { ...toast, id, open: true },
      ]);
      window.setTimeout(() => dismiss(id), 3000);
    },
    [dismiss],
  );
  useEffect(() => {
    const onToast = (event: Event) =>
      showToast((event as CustomEvent<ToastInput>).detail);
    window.addEventListener("nexora:toast", onToast);
    return () => window.removeEventListener("nexora:toast", onToast);
  }, [showToast]);
  const value = useMemo(() => ({ showToast }), [showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <aside
        aria-live="polite"
        aria-label="Application notifications"
        className="pointer-events-none fixed right-4 top-4 z-[3000] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3 [perspective:1000px]"
      >
        {items.map((item) => (
          <Slide
            key={item.id}
            direction="left"
            in={item.open}
            mountOnEnter
            unmountOnExit
          >
            <Alert
              severity={item.kind}
              variant="filled"
              iconMapping={icons}
              role={item.kind === "error" ? "alert" : "status"}
              className="pointer-events-auto toast-material"
              action={
                <IconButton
                  aria-label="Dismiss notification"
                  color="inherit"
                  size="small"
                  onClick={() => dismiss(item.id)}
                >
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              }
              sx={{
                alignItems: "center",
                boxShadow: "0 22px 60px rgba(15,23,42,.28)",
                backdropFilter: "blur(18px)",
                p: 1.5,
              }}
            >
              <AlertTitle sx={{ mb: item.message ? 0.25 : 0, fontWeight: 900 }}>
                {item.title}
              </AlertTitle>
              {item.message}
            </Alert>
          </Slide>
        ))}
      </aside>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}
