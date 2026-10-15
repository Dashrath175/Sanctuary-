/** drive limit, km/s */
export const MAX_SPEED = 200_000;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** "39,363", "1.4M", "2.7B" */
export const shortKm = (km: number) => (km >= 1e9 ? `${(km / 1e9).toFixed(1)}B` : km >= 1e6 ? `${(km / 1e6).toFixed(1)}M` : fmt(km));
