/**
 * Exact branch-and-bound over the scheduler model. Deterministic, anytime
 * (returns the best schedule found within the time budget, flagged
 * `optimal: false` if the search was cut short — in practice a full festival
 * instance solves exactly in well under a second).
 *
 * Search shape: items (films) are ordered by best screening value descending;
 * at each level we branch over "pick screening s" (in value order) then
 * "skip this film". Pruning uses an admissible bound: the Amy day-target
 * penalty is always ≥ 0, so
 *   best possible ≤ current value sum + Σ (best remaining screening values).
 */
import { amyPenalty, type SchedulerModel } from "./model.ts";

export interface SolveOptions {
  timeBudgetMs?: number;
}

export interface SolveResult {
  /** Chosen screenings as global indices into model.screenings. */
  chosen: number[];
  objective: number;
  optimal: boolean;
  nodesExplored: number;
  solveMs: number;
}

export class ConflictingPinsError extends Error {
  constructor(
    public readonly filmA: string,
    public readonly filmB: string,
    public readonly reason: string,
  ) {
    super(`Pinned screenings conflict: "${filmA}" vs "${filmB}" — ${reason}`);
  }
}

export function solve(model: SchedulerModel, options: SolveOptions = {}): SolveResult {
  const timeBudgetMs = options.timeBudgetMs ?? model.constraints.solver.timeBudgetMs;
  const startedAt = Date.now();

  // Items with something to schedule, best-value-first (stable on item index).
  const order = model.items
    .filter((item) => item.screenings.length > 0)
    .map((item) => ({
      item,
      best: Math.max(...item.screenings.map((s) => s.value)),
      options: [...item.screenings].sort((a, b) => b.value - a.value || a.index - b.index),
    }))
    .sort((a, b) => b.best - a.best || a.item.index - b.item.index);

  // Pinned items are forced: check pins against each other up front.
  const pinned = order.filter((o) => o.item.pinnedScreeningId);
  for (let i = 0; i < pinned.length; i++) {
    for (let j = i + 1; j < pinned.length; j++) {
      const a = pinned[i]!.options[0]!;
      const b = pinned[j]!.options[0]!;
      if (model.conflicts[a.index]!.includes(b.index)) {
        const key = a.index < b.index ? `${a.index}:${b.index}` : `${b.index}:${a.index}`;
        throw new ConflictingPinsError(
          pinned[i]!.item.title,
          pinned[j]!.item.title,
          model.conflictReasons.get(key) ?? "conflict",
        );
      }
    }
  }

  // suffixBest[i] = Σ best value of items i.. (skip always allowed → each term ≥ 0).
  const suffixBest = new Array<number>(order.length + 1).fill(0);
  for (let i = order.length - 1; i >= 0; i--) suffixBest[i] = suffixBest[i + 1]! + Math.max(0, order[i]!.best);

  const blockedBy = new Uint16Array(model.screenings.length); // count of chosen screenings conflicting with s
  const chosenStack: number[] = [];
  const amyCount = new Map<string, number>();

  let bestChosen: number[] = [];
  let bestObjective = -Infinity;
  let nodesExplored = 0;
  let aborted = false;

  const leaf = (valueSum: number) => {
    const objective = valueSum - amyPenalty(model, amyCount);
    if (objective > bestObjective) {
      bestObjective = objective;
      bestChosen = [...chosenStack];
    }
  };

  const dfs = (level: number, valueSum: number) => {
    if (aborted) return;
    nodesExplored += 1;
    if ((nodesExplored & 1023) === 0 && Date.now() - startedAt > timeBudgetMs) {
      aborted = true;
      return;
    }
    if (level === order.length) {
      leaf(valueSum);
      return;
    }
    // Even a penalty-free completion can't beat the incumbent → prune.
    if (valueSum + suffixBest[level]! <= bestObjective) return;

    const { item, options } = order[level]!;
    for (const screening of options) {
      if (blockedBy[screening.index]! > 0) continue;
      chosenStack.push(screening.index);
      for (const other of model.conflicts[screening.index]!) blockedBy[other] = blockedBy[other]! + 1;
      if (screening.amyAttends) amyCount.set(screening.date, (amyCount.get(screening.date) ?? 0) + 1);

      dfs(level + 1, valueSum + screening.value);

      if (screening.amyAttends) amyCount.set(screening.date, amyCount.get(screening.date)! - 1);
      for (const other of model.conflicts[screening.index]!) blockedBy[other] = blockedBy[other]! - 1;
      chosenStack.pop();
      if (aborted) return;
    }
    // Skip branch — never allowed for a pinned item.
    if (!item.pinnedScreeningId) dfs(level + 1, valueSum);
  };

  // Greedy incumbent seeds the bound. Pinned items go first unconditionally
  // (pins are mutually compatible — checked above — so this always succeeds
  // and the fallback solution honours them even if the search is cut short).
  {
    const greedy: number[] = [];
    const blocked = new Set<number>();
    for (const pass of [true, false]) {
      for (const { item, options } of order) {
        if (!!item.pinnedScreeningId !== pass) continue;
        const pick = item.pinnedScreeningId
          ? options[0]!
          : options.find((s) => !blocked.has(s.index) && s.value > 0);
        if (!pick || (!item.pinnedScreeningId && blocked.has(pick.index))) continue;
        greedy.push(pick.index);
        for (const other of model.conflicts[pick.index]!) blocked.add(other);
      }
    }
    const greedyAmy = new Map<string, number>();
    let greedyValue = 0;
    for (const index of greedy) {
      const s = model.screenings[index]!;
      greedyValue += s.value;
      if (s.amyAttends) greedyAmy.set(s.date, (greedyAmy.get(s.date) ?? 0) + 1);
    }
    bestObjective = greedyValue - amyPenalty(model, greedyAmy);
    bestChosen = greedy;
  }

  dfs(0, 0);

  bestChosen.sort((a, b) => model.screenings[a]!.startMin - model.screenings[b]!.startMin);
  return {
    chosen: bestChosen,
    objective: bestObjective,
    optimal: !aborted,
    nodesExplored,
    solveMs: Date.now() - startedAt,
  };
}
