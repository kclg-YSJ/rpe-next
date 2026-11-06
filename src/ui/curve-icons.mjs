// Consistent 24-unit outline icons, independent of the platform's text font.
const paths = {
  select: 'M5 3v17l4.5-4.5 3 6 3-1.5-3-6H19Z',
  add: 'M12 5v14M5 12h14',
  delete: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  undo: 'm8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v3',
  redo: 'm16 4 5 5-5 5M21 9H11a7 7 0 0 0-7 7v3',
  fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 12h8M12 8v8',
  play: 'm8 4 12 8-12 8Z', pause: 'M8 4v16M16 4v16',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 2M12 17h.01',
  maximize: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  restore: 'M8 8V3h13v13h-5M3 8h13v13H3Z',
  check: 'm5 12 4 4L20 5',
  close: 'm6 6 12 12M18 6 6 18',
  save: 'M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8',
  saveNew: 'M11 21H3V3h14l4 4v4M7 3v6h10V3M7 21v-8h4M18 14v8M14 18h8',
  copy: 'M8 8h13v13H8ZM16 8V3H3v13h5',
  export: 'M12 15V3m-4 4 4-4 4 4M5 12H3v9h18v-9h-2',
  import: 'M12 3v12m-4-4 4 4 4-4M5 12H3v9h18v-9h-2',
  load: 'M13 4h7v7M20 4 10 14M9 4H4v16h16v-5',
};
export function curveIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
  svg.classList.add('curve-icon'); svg.dataset.icon = name;
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name]); svg.append(path); return svg;
}
