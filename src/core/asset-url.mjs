// Built-in assets are served from `assets/` next to the entry document. `import.meta.env.BASE_URL`
// is the base Vite was configured with — '/' for local development and the desktop build, and the
// GitHub Pages subpath for the deployed site — so the editor keeps working when it is not hosted
// at the domain root.
//
// The optional chaining keeps this module importable from plain Node (the unit tests import it
// directly), where `import.meta.env` does not exist and the domain root is the correct fallback.
const base = import.meta.env?.BASE_URL ?? '/';

export function assetUrl(path) {
  return `${base}assets/${path}`;
}
