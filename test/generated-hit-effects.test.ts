import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

test('生成的打击特效共用完整画布，末帧不裁切且清单只更新特效', () => {
  const root = mkdtempSync(join(tmpdir(), 'rpen-generated-effects-'));
  try {
    const assets = join(root, 'assets', 'rpe'); mkdirSync(assets, { recursive: true });
    const untouched = { path: 'Texture/Tap2.png', bytes: 7, sha256: 'unchanged' };
    const files = Array.from({ length: 31 }, (_, index) => ({ path: `Texture/img-${index + 1}.png` }));
    writeFileSync(join(assets, 'manifest.json'), JSON.stringify({ files: [...files, untouched] }));
    const generator = fileURLToPath(new URL('../tools/generate-safe-rpe-assets.ts', import.meta.url));
    execFileSync(process.execPath, [generator, '--effects-only', '--output', root]);
    const manifest = JSON.parse(readFileSync(join(assets, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.files.at(-1), untouched);
    const radii = [];
    for (const entry of manifest.files.slice(0, 31)) {
      const bytes = readFileSync(join(assets, entry.path));
      assert.equal(bytes.readUInt32BE(16), 256); assert.equal(bytes.readUInt32BE(20), 256);
      assert.equal(bytes.length, entry.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
      const chunks = [];
      for (let offset = 8; offset < bytes.length;) {
        const size = bytes.readUInt32BE(offset);
        if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
        offset += size + 12;
      }
      const pixels = inflateSync(Buffer.concat(chunks));
      const alpha = (horizontal: number, vertical: number) => pixels[vertical * 1025 + 1 + horizontal * 4 + 3];
      for (let coordinate = 0; coordinate < 256; coordinate++) {
        assert.equal(alpha(coordinate, 0), 0); assert.equal(alpha(coordinate, 255), 0);
        assert.equal(alpha(0, coordinate), 0); assert.equal(alpha(255, coordinate), 0);
      }
      let radius = 0;
      for (let horizontal = 128; horizontal < 256; horizontal++) if (alpha(horizontal, 128) >= 100) radius = horizontal - 128;
      radii.push(radius);
      if (entry.path.endsWith('img-31.png')) {
        assert.ok(alpha(Math.round(128 + Math.cos(0.5) * 96), Math.round(128 + Math.sin(0.5) * 96)) > 40);
      }
    }
    assert.ok(radii[30] >= radii[29] && radii[30] - radii[29] <= 4);
    assert.ok(radii[30] > 115);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
