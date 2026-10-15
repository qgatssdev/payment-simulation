declare global {
  namespace Express {
    interface Request {
      /** Correlation id, from a valid X-Request-Id header or generated. */
      id: string;
    }
  }
}

export {};
