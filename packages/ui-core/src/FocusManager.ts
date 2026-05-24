export type FocusDirection = 'up' | 'down' | 'left' | 'right';

export interface FocusNode {
  id: string;
  element: HTMLElement;
  row: number;
  col: number;
  group?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onEnter?: () => void;
  preferFocus?: boolean; // first element to focus in group
}

export interface FocusGroup {
  id: string;
  nodes: Map<string, FocusNode>;
  lastFocusedId?: string;
  trap?: boolean; // não sair do grupo com seta
}

export class FocusManager {
  private static instance: FocusManager;
  private nodes = new Map<string, FocusNode>();
  private groups = new Map<string, FocusGroup>();
  private currentFocusId: string | null = null;
  private activeGroupId: string | null = null;
  private historyStack: string[] = [];
  private enabled = false;

  static getInstance(): FocusManager {
    if (!this.instance) this.instance = new FocusManager();
    return this.instance;
  }

  // ── Lifecycle ────────────────────────────────────────────

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.blur();
  }

  // ── Registration ─────────────────────────────────────────

  register(node: FocusNode): void {
    this.nodes.set(node.id, node);
    if (node.group) {
      if (!this.groups.has(node.group)) {
        this.groups.set(node.group, { id: node.group, nodes: new Map() });
      }
      this.groups.get(node.group)!.nodes.set(node.id, node);
    }
  }

  unregister(id: string): void {
    const node = this.nodes.get(id);
    if (node?.group) {
      this.groups.get(node.group)?.nodes.delete(id);
    }
    this.nodes.delete(id);
    if (this.currentFocusId === id) this.currentFocusId = null;
  }

  registerGroup(group: FocusGroup): void {
    this.groups.set(group.id, group);
  }

  // ── Focus Control ────────────────────────────────────────

  focusById(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;
    this.applyFocus(node);
    return true;
  }

  focusFirst(groupId?: string): boolean {
    const searchIn = groupId
      ? [...(this.groups.get(groupId)?.nodes.values() ?? [])]
      : [...this.nodes.values()];

    const target = searchIn.find(n => n.preferFocus) ?? searchIn[0];
    if (!target) return false;
    this.applyFocus(target);
    return true;
  }

  focusGroup(groupId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    this.activeGroupId = groupId;
    const lastId = group.lastFocusedId;
    if (lastId && group.nodes.has(lastId)) {
      return this.focusById(lastId);
    }
    return this.focusFirst(groupId);
  }

  move(direction: FocusDirection): boolean {
    if (!this.enabled || !this.currentFocusId) {
      this.focusFirst();
      return true;
    }

    const current = this.nodes.get(this.currentFocusId);
    if (!current) return false;

    const group = current.group ? this.groups.get(current.group) : null;
    const searchIn = group?.trap
      ? [...group.nodes.values()]
      : [...this.nodes.values()];

    const candidates = searchIn.filter(n => n.id !== current.id);
    const next = this.findBestCandidate(current, direction, candidates);

    if (!next) return false;
    this.applyFocus(next);
    return true;
  }

  confirm(): void {
    if (!this.currentFocusId) return;
    const node = this.nodes.get(this.currentFocusId);
    node?.onEnter?.();
    node?.element.click();
  }

  back(): void {
    const prev = this.historyStack.pop();
    if (prev && this.nodes.has(prev)) {
      this.focusById(prev);
    }
  }

  blur(): void {
    const node = this.currentFocusId ? this.nodes.get(this.currentFocusId) : null;
    if (node) {
      node.element.blur();
      node.element.classList.remove('tv-focused');
      node.onBlur?.();
    }
    this.currentFocusId = null;
  }

  // ── Spatial Navigation ───────────────────────────────────

  private findBestCandidate(
    current: FocusNode,
    direction: FocusDirection,
    candidates: FocusNode[]
  ): FocusNode | null {
    const currentRect = current.element.getBoundingClientRect();

    const inDirection = candidates.filter(node => {
      const rect = node.element.getBoundingClientRect();
      switch (direction) {
        case 'up':    return rect.bottom <= currentRect.top + 2;
        case 'down':  return rect.top >= currentRect.bottom - 2;
        case 'left':  return rect.right <= currentRect.left + 2;
        case 'right': return rect.left >= currentRect.right - 2;
      }
    });

    if (inDirection.length === 0) return null;

    // Score por proximidade e alinhamento
    return inDirection.reduce<FocusNode | null>((best, node) => {
      const score = this.calculateScore(currentRect, node.element.getBoundingClientRect(), direction);
      if (!best) return node;
      const bestScore = this.calculateScore(currentRect, best.element.getBoundingClientRect(), direction);
      return score < bestScore ? node : best;
    }, null);
  }

  private calculateScore(
    from: DOMRect,
    to: DOMRect,
    direction: FocusDirection
  ): number {
    const fromCenterX = from.left + from.width / 2;
    const fromCenterY = from.top + from.height / 2;
    const toCenterX = to.left + to.width / 2;
    const toCenterY = to.top + to.height / 2;

    const dx = toCenterX - fromCenterX;
    const dy = toCenterY - fromCenterY;

    // Distância primária (direção do movimento) e secundária (alinhamento)
    let primary: number, secondary: number;

    switch (direction) {
      case 'up':    primary = Math.abs(dy); secondary = Math.abs(dx); break;
      case 'down':  primary = Math.abs(dy); secondary = Math.abs(dx); break;
      case 'left':  primary = Math.abs(dx); secondary = Math.abs(dy); break;
      case 'right': primary = Math.abs(dx); secondary = Math.abs(dy); break;
    }

    // Penalizar desalinhamento 3x
    return primary + secondary * 3;
  }

  private applyFocus(node: FocusNode): void {
    // Remover foco anterior
    if (this.currentFocusId && this.currentFocusId !== node.id) {
      const prev = this.nodes.get(this.currentFocusId);
      if (prev) {
        prev.element.blur();
        prev.element.classList.remove('tv-focused');
        prev.onBlur?.();
      }
      this.historyStack.push(this.currentFocusId);
      if (this.historyStack.length > 20) this.historyStack.shift();
    }

    // Atualizar grupo
    if (node.group) {
      const group = this.groups.get(node.group);
      if (group) group.lastFocusedId = node.id;
      this.activeGroupId = node.group;
    }

    this.currentFocusId = node.id;
    node.element.focus({ preventScroll: true });
    node.element.classList.add('tv-focused');
    node.onFocus?.();

    // Scroll suave para o elemento
    node.element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  getCurrentFocusId(): string | null { return this.currentFocusId; }
  getActiveGroupId(): string | null { return this.activeGroupId; }
  isEnabled(): boolean { return this.enabled; }
}
