// Batch independent horizontal strokes by their existing style. The number of
// canvas strokes no longer grows with subdivision density; text stays separate.
export function paintTimelineGrid(context, ticks, { left = 0, right, vertical, colors, widths, spacing = 6, labelX = left + 5, labelOffset = -4, labelColor = '#dddddd', labels = true }) {
  const paths = [[], [], []], captions = [], mergedMinor = colors[0] === colors[1] && widths[0] === widths[1];
  // Wide translucent bars may overlap. Preserve their original composition.
  const ordered = Math.max(...widths) > spacing ? [] : null;
  const add = (row, group, y) => {
    if (!Number.isFinite(y)) return;
    if (ordered) ordered.push({ ...row, group, y });
    else { paths[group].push(y); if (labels && row.label) captions.push([row.beat, y]); }
  };
  for (const row of ticks) {
    const group = row.major ? 2 : mergedMinor || row.tick % 2 ? 0 : 1;
    const positions = vertical(row.beat);
    if (Array.isArray(positions)) {
      for (const y of positions) add(row, group, y);
    } else add(row, group, positions);
  }
  if (ordered) {
    for (const { group, y, beat, label } of ordered) {
      context.strokeStyle = colors[group]; context.lineWidth = widths[group]; context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke();
      if (labels && label) { context.fillStyle = labelColor; context.fillText(String(beat), labelX, y + labelOffset); }
    }
    return;
  }
  for (let group = 0; group < paths.length; group++) {
    if (!paths[group].length) continue;
    context.strokeStyle = colors[group]; context.lineWidth = widths[group]; context.beginPath();
    for (const y of paths[group]) { context.moveTo(left, y); context.lineTo(right, y); }
    context.stroke();
  }
  if (captions.length) {
    context.fillStyle = labelColor;
    for (const [beat, y] of captions) context.fillText(String(beat), labelX, y + labelOffset);
  }
}
