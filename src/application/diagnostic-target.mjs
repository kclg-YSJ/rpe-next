import { shaderEvents } from '../core/shader-events.mjs';
import { shaderLine } from '../core/shader.mjs';

// Worker diagnostics carry serializable source locations, not shared references.
// Resolve the raw effect on demand so legacy type-based ownership matches playback.
export function diagnosticShaderTarget(chart, issue) {
  let root, sourceIndex;
  const roots = { effects: chart.effects, shaderEvents: chart.shaderEvents, 'META.effects': chart.META?.effects };
  if (issue.shaderRoot && Number.isInteger(issue.shaderIndex)) { root = issue.shaderRoot; sourceIndex = issue.shaderIndex; }
  else {
    const bracket = issue.path?.match(/^(effects|shaderEvents|META\.effects)\[(\d+)\]/);
    const flattened = issue.path?.match(/^effects\.(\d+)/);
    if (bracket) { root = bracket[1]; sourceIndex = Number(bracket[2]); }
    else if (flattened) {
      let index = Number(flattened[1]);
      for (const [name, events] of Object.entries(roots)) if (Array.isArray(events)) {
        if (index < events.length) { root = name; sourceIndex = index; break; }
        index -= events.length;
      }
    }
  }
  const raw = roots[root]?.[sourceIndex];
  if (!raw) return null;
  const lineIndex = shaderLine(raw, chart);
  let index = 0;
  for (const [name, events] of Object.entries(roots)) for (const [i, event] of (Array.isArray(events) ? events : []).entries()) {
    if (!event || typeof event !== 'object' || shaderLine(event, chart) !== lineIndex) continue;
    if (name === root && i === sourceIndex) return { lineIndex, index, event: shaderEvents(chart, lineIndex)[index] };
    index++;
  }
  return null;
}
