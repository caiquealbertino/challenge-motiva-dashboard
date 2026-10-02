const override = new URLSearchParams(location.search).get("api");
const host = location.hostname || "127.0.0.1";

export const API_BASE = (override || `http://${host}:8000`).replace(/\/$/, "");
