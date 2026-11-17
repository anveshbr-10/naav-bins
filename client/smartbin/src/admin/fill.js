// Fill bands shared by the bins table and the fleet map:
// under 50% empty (green), 50–79% partly full (orange), 80%+ full (red).
export const FILL_PARTIAL = 50;
export const FILL_FULL = 80;

export function fillBandColor(level) {
  return level >= FILL_FULL ? '#ef4444' : level >= FILL_PARTIAL ? '#f97316' : '#10b981';
}
