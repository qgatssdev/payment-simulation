/** Where the browser reaches the API. Inlined at build time (NEXT_PUBLIC_*). */
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
).replace(/\/+$/, '');
