import axios from "axios";
import { emitToast } from "../features/toast/ToastProvider";

let accessToken: string | null = (() => {
  try {
    return sessionStorage.getItem("nexora_access_token");
  } catch {
    return null;
  }
})();
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  try {
    if (token) sessionStorage.setItem("nexora_access_token", token);
    else sessionStorage.removeItem("nexora_access_token");
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function hasAccessToken() {
  return Boolean(accessToken);
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:4000/api",
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

const shouldToast = (config: any) => {
  const method = String(config?.method ?? "get").toLowerCase();
  const url = String(config?.url ?? "");
  return ["post", "put", "patch", "delete"].includes(method) &&
    !url.includes("/auth/") && !url.includes("/storage/") &&
    !/\/exam-attempts\/[^/]+\/answers/.test(url) && !config?._retry;
};
const successTitle = (config: any) => {
  const method = String(config?.method ?? "").toLowerCase();
  if (method === "delete") return "Deleted successfully";
  if (method === "patch" || method === "put") return "Saved successfully";
  return "Created successfully";
};

api.interceptors.response.use(
  (response) => {
    if (shouldToast(response.config)) emitToast({ kind: "success", title: successTitle(response.config), message: response.data?.message });
    return response;
  },
  async (error) => {
    const original = error.config;
    if (
      error.response?.status !== 401 ||
      original?._retry ||
      original?.url?.includes("/auth/refresh")
    ) {
      if (shouldToast(original)) emitToast({ kind: "error", title: "Action failed", message: error.response?.data?.message ?? "Please try again." });
      return Promise.reject(error);
    }
    original._retry = true;
    refreshPromise ??= api
      .post("/auth/refresh")
      .then((r) => {
        setAccessToken(r.data.accessToken);
        return r.data.accessToken as string;
      })
      .catch(() => {
        setAccessToken(null);
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });

    const token = await refreshPromise;
    if (!token) {
      if (shouldToast(original)) emitToast({ kind: "error", title: "Action failed", message: error.response?.data?.message ?? "Please sign in again." });
      return Promise.reject(error);
    }
    original.headers.Authorization = `Bearer ${token}`;
    return api(original);
  },
);
