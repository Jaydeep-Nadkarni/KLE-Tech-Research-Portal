// Missing data is N/A; zero is a real value and is shown as 0.
export const NA = 'N/A';
export const n = (v) => (v === null || v === undefined ? NA : Number(v).toLocaleString('en-IN'));
export const dec = (v, d = 1) => (v === null || v === undefined ? NA : Number(v).toFixed(d));
export const date = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : NA);
export const dateTime = (v) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : NA);
export const ago = (v) => {
  if (!v) return 'Never';
  const s = (Date.now() - new Date(v)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

export const SOURCES = [
  { value: 'scopus', label: 'Scopus' },
  { value: 'openalex', label: 'OpenAlex' },
  { value: 'semanticscholar', label: 'Semantic Scholar' },
  { value: 'crossref', label: 'Crossref' },
  { value: 'googlescholar', label: 'Google Scholar' },
  { value: 'webofscience', label: 'Web of Science' },
];

// Categorical palette (colour-blind-safe order). Meaning is never carried by colour alone.
export const PALETTE = ['#1f4e79', '#c47f17', '#2e8b6e', '#8e4a7c', '#b5483a', '#5f7183', '#7a9e3c', '#3c8fa6'];
