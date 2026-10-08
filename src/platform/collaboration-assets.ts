/** The transport surface asset delivery needs, declared structurally so a test double can satisfy it. */
export interface AssetTransport {
  assetDelivery?: boolean;
  sendAsset(message: Record<string, unknown>): Promise<unknown> | unknown;
}

/** Base64-encodes bytes in 8 KiB slices, so a large asset never blows the argument limit. */
export function assetBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(parts.join(''));
}

/**
 * Sends an asset as numbered chunks, in parallel when the transport supports it.
 *
 * The first failure stops the remaining workers and is rethrown once they settle, so a partial
 * transfer reports the underlying error rather than hanging.
 */
export async function sendCollaborationAsset(transport: AssetTransport, name: string, bytes: Uint8Array, digest: string, onProgress: (completed: number, total: number) => void = () => {}): Promise<void> {
  const chunkSize = transport.assetDelivery ? 256 * 1024 : 49152;
  const total = Math.ceil(bytes.length / chunkSize);
  const parallel = transport.assetDelivery ? 4 : 1;
  const transfer = crypto.randomUUID();
  let next = 0; let completed = 0; let failure: unknown;
  const workers = Array.from({ length: Math.min(parallel, total) }, async () => {
    while (!failure && next < total) {
      const index = next++;
      const chunk = bytes.subarray(index * chunkSize, (index + 1) * chunkSize);
      try {
        await transport.sendAsset({ type: 'asset', name, hash: digest, transfer, index, total, data: assetBase64(chunk) });
        completed += chunk.length; onProgress(completed, bytes.length);
      } catch (error) { failure ??= error; }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
}
