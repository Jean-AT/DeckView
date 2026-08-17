// Limiter de ventana deslizante en memoria para llamadas salientes hacia las
// APIs externas (evita pegarte con los límites de uso de proveedores).
export interface RateLimiter {
  allow(key: string): boolean;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const timestampsByKey = new Map<string, number[]>();

  return {
    allow(key: string): boolean {
      const now = Date.now();
      const timestamps = (timestampsByKey.get(key) ?? []).filter(
        (t) => now - t < windowMs,
      );

      if (timestamps.length >= limit) {
        timestampsByKey.set(key, timestamps);
        return false;
      }

      timestamps.push(now);
      timestampsByKey.set(key, timestamps);
      return true;
    },
  };
}
