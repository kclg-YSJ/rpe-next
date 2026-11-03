const shared = ['src/core', 'src/i18n.mjs', 'src/locales', 'LICENSE', 'NOTICE'];

export const EDITOR_PACKAGE_SOURCES = Object.freeze([
  ...shared, 'desktop', 'src/application', 'src/platform', 'src/ui', 'assets', 'index.html', 'styles.css',
  'protocols/EDITOR-SKIN-PROTOCOL.zh-CN.md', 'protocols/MOD-PROTOCOL.zh-CN.md', 'protocols/GLOBAL-EVENTS-PROTOCOL.zh-CN.md', 'protocols/ANIMATION-CURVES-PROTOCOL.zh-CN.md', 'protocols/VIDEO-RENDER.zh-CN.md',
  'protocols/AI-AGENT-PROTOCOL.zh-CN.md', 'protocols/AUDIO-SEPARATION.zh-CN.md', 'protocols/CHART-VERSION-CONTROL.zh-CN.md', 'protocols/LARGE-CHART-PREVIEW.zh-CN.md', 'schemas',
  'tools/smoke-mods.mjs', 'tools/smoke-native.mjs', 'tools/smoke-asset-library.mjs', 'tools/smoke-settings-renderer.js',
  'tools/smoke-saving.mjs', 'tools/smoke-agent.mjs', 'tools/smoke-agent-upgrade.mjs', 'tools/smoke-audio.mjs'
]);

export const SERVER_PACKAGE_SOURCES = Object.freeze([
  ...shared, 'collaboration-server/server.mjs', 'collaboration-server/asset-store.mjs', 'collaboration-server/manager.cjs',
  'collaboration-server/diagnostics.cjs', 'collaboration-server/preload.cjs', 'collaboration-server/manager.html',
  'collaboration-server/manager.css', 'collaboration-server/manager.js', 'collaboration-server/README.md'
]);
