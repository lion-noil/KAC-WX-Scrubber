// src/utils/env.js
export const ONLINE = import.meta.env.PROD;   // Vercel(빌드) = true
export const LOCAL_ONLY = !ONLINE;            // 로컬 dev = true
