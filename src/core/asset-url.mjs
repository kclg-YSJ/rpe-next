// Built-in assets live in the repository-root `assets/` directory. Resolve them relative to this
// module rather than the page: the same URL then works from Node's file system (unit tests), Vite
// development, the bundled build under any `base` (including the GitHub Pages subpath) and the
// `rpe://app` desktop protocol. `moduleUrl` is injectable for tests that need a fixed origin.
export function assetUrl(path, moduleUrl = import.meta.url) {
  return new URL(`../../assets/${path}`, moduleUrl).href;
}
