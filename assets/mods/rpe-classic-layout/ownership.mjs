// Restore only mutations made by this extension; keep native nodes and listeners.
export class NodeOwnership {
  constructor() { this.moves = new Map(); this.attributes = new Map(); }
  move(node, parent, before = null) {
    if (!node || node.parentNode === parent && !before) return node;
    if (!this.moves.has(node)) {
      const anchor = document.createComment('rpe-classic-return');
      node.before(anchor);
      this.moves.set(node, { parent: node.parentNode, anchor });
    }
    parent.insertBefore(node, before);
    return node;
  }
  attribute(node, name, value) {
    if (!node) return;
    let entries = this.attributes.get(node);
    if (!entries) this.attributes.set(node, entries = new Map());
    if (!entries.has(name)) entries.set(name, { before: node.getAttribute(name), ours: null });
    const entry = entries.get(name); entry.ours = String(value);
    node.setAttribute(name, entry.ours);
  }
  owns(node) { return this.moves.has(node); }
  restore() {
    for (const [node, { parent, anchor }] of [...this.moves].reverse()) {
      if(!node.isConnected){anchor.remove();continue;}
      if (anchor.parentNode) anchor.before(node);
      else if (parent.isConnected) parent.append(node);
      anchor.remove();
    }
    this.moves.clear();
    for (const [node, entries] of this.attributes) for (const [name, entry] of entries) {
      if (node.getAttribute(name) !== entry.ours) continue;
      if (entry.before === null) node.removeAttribute(name); else node.setAttribute(name, entry.before);
    }
    this.attributes.clear();
  }
}

export function positioned(node, x, y, width = 40, height = 40, centered = true) {
  node.classList.add('rc-positioned');
  node.style.setProperty('--rc-x', String(centered ? x - width / 2 : x));
  node.style.setProperty('--rc-y', String(centered ? y - height / 2 : y));
  node.style.setProperty('--rc-w', String(width));
  node.style.setProperty('--rc-h', String(height));
  return node;
}

export function controlSlot(parent, node, position, className = '') {
  const slot = document.createElement('div');
  slot.className = 'rc-slot ' + className;
  positioned(slot, ...position); parent.append(slot);
  if (node) slot.append(node);
  return slot;
}
