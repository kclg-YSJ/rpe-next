/** Where a collaborator's time marker sits on the scrubber track, in pixels. */
export interface CollaborationMarkerRange {
  offset?: number;
  minimum?: number;
  maximum?: number;
  width: number;
  inset?: number;
}

export function collaborationMarkerPosition(seconds: unknown, { offset = 0, minimum = 0, maximum, width, inset = 8 }: CollaborationMarkerRange): number {
  const ratio = Math.max(0, Math.min(1, (Number(seconds) + Number(offset) - Number(minimum)) / Math.max(0.001, Number(maximum) - Number(minimum))));
  const edge = Math.min(inset, Math.max(0, width) / 2);
  return edge + ratio * Math.max(0, width - edge * 2);
}

/**
 * Picks a black or white label background for a member's colour, by comparing the contrast ratio
 * against each. Relative luminance follows the sRGB formula, so mid-tones resolve the same way the
 * CSS contrast guidance does.
 */
export function collaborationLabelBackground(color: string): string {
  const channels = /^#[0-9a-f]{6}$/i.test(color) ? (color.slice(1).match(/../g) ?? []).map(channel => parseInt(channel, 16) / 255) : [1, 1, 1];
  const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = (linear[0] ?? 1) * 0.2126 + (linear[1] ?? 1) * 0.7152 + (linear[2] ?? 1) * 0.0722;
  return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.05 ? '#ffffff' : '#000000';
}
