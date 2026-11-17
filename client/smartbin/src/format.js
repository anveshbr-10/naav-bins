// Shared number/date formatting so every page shows impact the same way.

export function formatCo2(kg) {
  const n = Number(kg) || 0;
  if (n === 0) return '0 g';
  return n < 1 ? `${Math.round(n * 1000)} g` : `${n.toFixed(n < 10 ? 2 : 1)} kg`;
}

export function formatKg(kg) {
  const n = Number(kg) || 0;
  return n < 1 ? `${Math.round(n * 1000)} g` : `${n.toFixed(n < 10 ? 2 : 1)} kg`;
}

export function formatInr(amount) {
  return `₹${(Number(amount) || 0).toLocaleString('en-IN')}`;
}

export function formatCount(n) {
  return (Number(n) || 0).toLocaleString('en-IN');
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${d.toLocaleDateString()} at ${d.toLocaleTimeString()}`;
}

export function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}
