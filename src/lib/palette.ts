/** Categorical series palette, validated for lightness, chroma, CVD
 *  separation, and contrast on the light surface. Hues are assigned to
 *  units in fixed sort order and never cycled or repainted on filter. */
export const SERIES_COLORS = [
  '#1D4ED8',
  '#0F9D76',
  '#9333EA',
  '#0891B2',
  '#DB2777',
  '#4087C7',
  '#6D28D9',
];

export function seriesColor(index: number): string {
  // Beyond the palette, entities fold into a neutral rather than a new hue.
  return SERIES_COLORS[index] ?? '#64748B';
}

/** Status colors for RAG, always paired with a label or icon. */
export const RAG_COLORS: Record<string, string> = {
  green: '#047857',
  amber: '#B45309',
  red: '#B42318',
  none: '#94A3B8',
};
