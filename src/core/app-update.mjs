export const APP_VERSION = '0.13.2';
export const UPDATE_REPOSITORY = 'kclg-YSJ/rpe-next';
export const UPDATE_REPOSITORY_URL = 'https://github.com/' + UPDATE_REPOSITORY;
export const UPDATE_RELEASES_URL = 'https://api.github.com/repos/' + UPDATE_REPOSITORY + '/releases?per_page=30';
export const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
export const UPDATE_MANUAL_INTERVAL = 60 * 1000;
export const UPDATE_MAX_BYTES = 2 * 1024 ** 3;

export function updateVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value));
  return match && match.slice(1, 4).every(n => Number.isSafeInteger(Number(n))) ? { numbers: match.slice(1, 4).map(Number), suffix: match[4] ?? '' } : null;
}
export function compareUpdateVersions(a, b) {
  const left = updateVersion(a), right = updateVersion(b); if (!left || !right) throw Error('Invalid release version');
  for (let i = 0; i < 3; i++) if (left.numbers[i] !== right.numbers[i]) return left.numbers[i] > right.numbers[i] ? 1 : -1;
  if (left.suffix === right.suffix) return 0; if (!left.suffix || !right.suffix) return left.suffix ? -1 : 1;
  const x = left.suffix.split('.'), y = right.suffix.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1;
    if (x[i] === y[i]) continue;
    const nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
    if (nx && ny) return Number(x[i]) > Number(y[i]) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1; return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}
export function officialUpdateUrl(value, { asset = false, redirect = false } = {}) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) throw Error('Untrusted update address');
  if (redirect && ['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'].includes(url.hostname)) return url.href;
  if (asset) {
    if (url.hostname !== 'github.com' || !url.pathname.toLowerCase().startsWith('/' + UPDATE_REPOSITORY.toLowerCase() + '/releases/download/') || url.search) throw Error('Untrusted release asset');
  } else if (url.hostname !== 'api.github.com' || url.pathname.toLowerCase() !== '/repos/' + UPDATE_REPOSITORY.toLowerCase() + '/releases') throw Error('Untrusted release feed');
  return url.href;
}
export function selectUpdateRelease(data, platform, arch) {
  if (!Array.isArray(data)) throw Error('Invalid release response');
  const entries = data.filter(release => release && !release.draft && updateVersion(release.tag_name));
  entries.sort((a, b) => compareUpdateVersions(b.tag_name, a.tag_name));
  for (const release of entries) {
    const version = release.tag_name.replace(/^v/, ''), platformName = { win32: 'windows', darwin: 'macos', linux: 'linux' }[platform];
    const filename = platformName ? `rpe-next-${version}-${platformName}-${arch}.${platform === 'win32' ? 'zip' : platform === 'darwin' ? 'dmg' : 'tar.xz'}` : null;
    const asset = release.assets?.find(entry => entry.name === filename), checksums = release.assets?.find(entry => entry.name === 'SHA256SUMS.txt');
    if (platformName && !asset) continue;
    const info = { version, tag: release.tag_name, notes: String(release.body ?? '').slice(0, 100000), url: `${UPDATE_REPOSITORY_URL}/releases/tag/${encodeURIComponent(release.tag_name)}` };
    if (asset) {
      if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size >= UPDATE_MAX_BYTES) throw Error('Invalid update package size');
      info.asset = { name: filename, size: asset.size, url: officialUpdateUrl(asset.browser_download_url, { asset: true }), sha256: /^sha256:[a-f0-9]{64}$/i.test(asset.digest) ? asset.digest.slice(7).toLowerCase() : null };
      if (checksums) info.checksumsUrl = officialUpdateUrl(checksums.browser_download_url, { asset: true });
    }
    return info;
  }
  return null;
}
export function updateChecksum(text, filename) {
  const line = String(text).split(/\r?\n/).find(line => line.slice(66).replace(/^\*/, '') === filename);
  if (!line || !/^[a-f0-9]{64} [ *]/i.test(line)) throw Error('Missing package checksum');
  return line.slice(0, 64).toLowerCase();
}
export function publicUpdateInfo(state, version) {
  return { version, latest: state.latest ?? null, available: Boolean(state.latest && compareUpdateVersions(state.latest.version, version) > 0), autoCheck: state.autoCheck !== false, checked: state.checked ?? 0 };
}
