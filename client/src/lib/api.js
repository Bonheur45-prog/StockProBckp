import axios from "axios";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      // Let the app redirect to /login via AuthContext's isAuthenticated check
      // rather than force-reloading here, so an offline 401 (stale token,
      // no network to verify) doesn't nuke unsynced local work.
    }
    return Promise.reject(err);
  }
);
