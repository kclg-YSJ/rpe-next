// RPE saves AutoSave_<timestamp>_<chart> and AutoSave_extra_<timestamp>_.json.
// Older versions omit the timestamp. Match chart files, never media or folders.
export function isBackupChartFile(path: string): boolean {
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? '';
  return /^AutoSave_.+\.(?:json|pec)$/i.test(name) || /\.(?:json|pec)\.(?:bak|backup)(?:\.\d+)?$/i.test(name);
}

export function isChartDocumentFile(path: string): boolean {
  return /\.(?:json|pec)$/i.test(path) || /\.(?:json|pec)\.(?:bak|backup)(?:\.\d+)?$/i.test(path);
}
