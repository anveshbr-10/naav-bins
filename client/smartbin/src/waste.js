import { tk } from './i18n';

// Display metadata per material. Rewards, points and each material's stream come from the server
// (database reward table) — never from here.
export const WASTE_TYPES = [
  { name: 'Plastic',           label: tk('Plastic'),           emoji: '🧴', color: '#F59E0B', model: 'Plastic' },
  { name: 'Metal',             label: tk('Metal'),             emoji: '🔩', color: '#94A3B8', model: 'Metal' },
  { name: 'Paper / Cardboard', label: tk('Paper / Cardboard'), emoji: '📦', color: '#92400E', model: 'Paper_Cardboard' },
  { name: 'Glass',             label: tk('Glass'),             emoji: '🫙', color: '#0891B2', model: 'Glass' },
  { name: 'Organic',           label: tk('Organic'),           emoji: '🌿', color: '#16A34A', model: 'organic' },
  { name: 'Other Trash',       label: tk('Other Trash'),       emoji: '🗑️', color: '#DC2626', model: 'Other_trash' },
];
export const WASTE_BY_NAME = Object.fromEntries(WASTE_TYPES.map((w) => [w.name, w]));
export const WASTE_BY_MODEL = Object.fromEntries(WASTE_TYPES.map((w) => [w.model, w]));

// BBMP (Bruhat Bengaluru Mahanagara Palike) source-segregation streams: "2 bins, 1 bag".
export const STREAMS = {
  dry: {
    label: tk('Dry waste'), bin: tk('Blue bin'), color: '#2563EB', icon: '♻️',
    examples: tk('Plastic, paper, cardboard, metal cans, glass, tetra packs'),
    rule: tk('Keep it clean and dry. Rinse food containers; flatten boxes.'),
  },
  wet: {
    label: tk('Wet waste'), bin: tk('Green bin'), color: '#16A34A', icon: '🌿',
    examples: tk('Food scraps, fruit and vegetable peels, tea leaves, leaves and flowers'),
    rule: tk('No plastic bags. It is composted on campus or by BBMP.'),
  },
  reject: {
    label: tk('Reject / sanitary waste'), bin: tk('Red bin'), color: '#DC2626', icon: '⚠️',
    examples: tk('Sanitary pads, diapers, tissues, chip packets that are soiled, cigarette butts'),
    rule: tk('Wrap sanitary waste in paper and mark it with a red dot.'),
  },
  station: {
    label: tk('Sorting station'), bin: tk('Every compartment'), color: '#0F766E', icon: '🗂️',
    examples: tk('Accepts every stream: the app tells you which compartment to use.'),
    rule: '',
  },
};

export function streamOf(name) {
  return STREAMS[name] || STREAMS.station;
}

// Redemption statuses (stored in English; shown translated).
export const STATUS_LABEL = {
  Issued: tk('Issued'), Pending: tk('Pending'), Paid: tk('Paid'), Claimed: tk('Claimed'),
  Rejected: tk('Rejected'), Cancelled: tk('Cancelled'), Completed: tk('Completed'),
};
