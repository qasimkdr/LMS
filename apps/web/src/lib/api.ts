import axios from "axios";

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

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (
      error.response?.status !== 401 ||
      original?._retry ||
      original?.url?.includes("/auth/refresh")
    ) {
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
    if (!token) return Promise.reject(error);
    original.headers.Authorization = `Bearer ${token}`;
    return api(original);
  },
);
