import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorRoundedIcon from "@mui/icons-material/ErrorRounded";
import InfoRoundedIcon from "@mui/icons-material/InfoRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";

export type ToastKind = "success" | "error" | "info";
export type ToastInput = { kind: ToastKind; title: string; message?: string };
type ToastItem = ToastInput & { id: number; leaving?: boolean };

const ToastContext = createContext<{ showToast: (toast: ToastInput) => void } | null>(null);

export function emitToast(toast: ToastInput) {
  window.dispatchEvent(new CustomEvent<ToastInput>("nexora:toast", { detail: toast }));
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, leaving: true } : item));
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 280);
  }, []);
  const showToast = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-3), { ...toast, id }]);
    window.setTimeout(() => dismiss(id), 3000);
  }, [dismiss]);
  useEffect(() => {
    const onToast = (event: Event) => showToast((event as CustomEvent<ToastInput>).detail);
    window.addEventListener("nexora:toast", onToast);
    return () => window.removeEventListener("nexora:toast", onToast);
  }, [showToast]);
  const value = useMemo(() => ({ showToast }), [showToast]);
  return <ToastContext.Provider value={value}>
    {children}
    <aside aria-live="polite" aria-label="Application notifications" className="pointer-events-none fixed right-4 top-4 z-[3000] flex w-[min(390px,calc(100vw-2rem))] flex-col gap-3 [perspective:900px]">
      {items.map((item) => {
        const tone = item.kind === "success" ? "from-emerald-500 to-teal-600" : item.kind === "error" ? "from-rose-500 to-red-600" : "from-blue-500 to-indigo-600";
        const Icon = item.kind === "success" ? CheckCircleRoundedIcon : item.kind === "error" ? ErrorRoundedIcon : InfoRoundedIcon;
        return <div key={item.id} role={item.kind === "error" ? "alert" : "status"} className={`pointer-events-auto relative overflow-hidden rounded-[22px] bg-gradient-to-br ${tone} p-[1px] shadow-[0_22px_60px_rgba(15,23,42,.28)] ${item.leaving ? "animate-[toast-out_.28s_ease-in_forwards]" : "animate-[toast-in_.42s_cubic-bezier(.2,.9,.25,1.25)_both]"}`}>
          <div className="relative flex items-start gap-3 rounded-[21px] bg-slate-950/90 p-4 text-white backdrop-blur-xl">
            <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${tone} shadow-lg`}><Icon /></div>
            <div className="min-w-0 flex-1"><p className="font-black">{item.title}</p>{item.message && <p className="mt-1 text-sm leading-5 text-white/70">{item.message}</p>}</div>
            <button aria-label="Dismiss notification" onClick={() => dismiss(item.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 transition hover:rotate-90 hover:bg-white/20"><CloseRoundedIcon sx={{ fontSize: 18 }} /></button>
            <span className={`absolute inset-x-0 bottom-0 h-1 origin-left bg-gradient-to-r ${tone} animate-[toast-timer_3s_linear_forwards]`} />
          </div>
        </div>;
      })}
    </aside>
  </ToastContext.Provider>;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}
