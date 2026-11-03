import { lstat, realpath, statfs } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

export async function largeChartSpace(directory, requiredBytes) {
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < requiredBytes) throw Error('所选位置的可用空间不足，请选择空间充足的磁盘或目录');
}

export const insideLargeChartDirectory = (root, target) => {
  const child = relative(root, target);
  return child === '' || !isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep);
};

export async function largeChartSaveDestination(destination, cacheRoot) {
  if (typeof destination !== 'string' || !isAbsolute(destination)) throw Error('请选择完整的工程保存路径');
  const parent = await realpath(dirname(destination)), root = await realpath(cacheRoot);
  if (insideLargeChartDirectory(root, parent)) throw Error('请将工程保存在缓存目录之外');
  const actual = join(parent, basename(destination));
  try {
    const info = await lstat(actual);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('工程保存目标必须是普通文件，不能是链接或目录');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return actual;
}
