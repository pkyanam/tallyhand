/**
 * Rate cards — per-client / per-project rate tables.
 *
 * A rate card pins the rates a client (or one of their projects) is billed
 * at: a default rate plus optional per-activity/per-role lines ("Backend
 * dev → $175/hr"). `resolveRate` implements the precedence used everywhere
 * a rate is needed (invoicing, analytics):
 *
 *   project.rateOverride
 *     > project-scoped card line (matching label)
 *     > project-scoped card default
 *     > client-scoped card line (matching label)
 *     > client-scoped card default
 *     > client.defaultRate
 *
 * Only cards effective at the given time participate; archived cards never do.
 */
import type { ID, Timestamped } from "./entities";

export interface RateCardLine {
  id: ID;
  /** Activity or role label, e.g. "Backend dev", "Design", "On-call". */
  label: string;
  /** Dollars per hour. */
  rate: number;
}

export interface RateCard extends Timestamped {
  id: ID;
  clientId: ID;
  /** When set, this card applies only to this project. */
  projectId?: ID;
  name: string;
  /** Dollars per hour fallback for the card. */
  defaultRate: number;
  lines: RateCardLine[];
  /** ms epoch from which the card is effective. */
  effectiveFrom: number;
  /** ms epoch; omitted = no end. */
  effectiveTo?: number;
  archived: boolean;
}

export type RateCardCreateInput = Omit<
  RateCard,
  "id" | "createdAt" | "updatedAt" | "archived"
> & { id?: ID; archived?: boolean };

export interface RateResolutionContext {
  clientId: ID;
  projectId?: ID;
  /** Activity/role label to match against card lines. */
  lineLabel?: string;
  clientDefaultRate?: number;
  projectRateOverride?: number;
}

function cardIsEffective(card: RateCard, atMs: number): boolean {
  if (card.archived) return false;
  if (card.effectiveFrom > atMs) return false;
  if (card.effectiveTo != null && card.effectiveTo < atMs) return false;
  return true;
}

function matchLine(card: RateCard, label?: string): number | undefined {
  if (!label) return undefined;
  const line = card.lines.find(
    (l) => l.label.toLowerCase() === label.toLowerCase(),
  );
  return line?.rate;
}

/**
 * Resolve the hourly rate for a unit of work. Returns undefined when no
 * source provides a rate (caller decides the fallback / error).
 */
export function resolveRate(
  cards: RateCard[],
  ctx: RateResolutionContext,
  atMs: number,
): number | undefined {
  if (ctx.projectRateOverride != null && ctx.projectRateOverride >= 0) {
    return ctx.projectRateOverride;
  }
  const effective = cards.filter((c) => cardIsEffective(c, atMs));
  // Most recently effective card wins within a scope.
  const byRecency = [...effective].sort((a, b) => b.effectiveFrom - a.effectiveFrom);
  const projectCards = byRecency.filter(
    (c) => c.clientId === ctx.clientId && c.projectId === ctx.projectId,
  );
  const clientCards = byRecency.filter(
    (c) => c.clientId === ctx.clientId && c.projectId == null,
  );

  if (ctx.projectId) {
    for (const card of projectCards) {
      const line = matchLine(card, ctx.lineLabel);
      if (line != null) return line;
    }
    if (projectCards.length > 0) return projectCards[0].defaultRate;
  }
  for (const card of clientCards) {
    const line = matchLine(card, ctx.lineLabel);
    if (line != null) return line;
  }
  if (clientCards.length > 0) return clientCards[0].defaultRate;
  return ctx.clientDefaultRate;
}

/** Active (effective right now, not archived) cards for a client. */
export function activeRateCards(
  cards: RateCard[],
  clientId: ID,
  atMs: number,
): RateCard[] {
  return cards
    .filter((c) => c.clientId === clientId && cardIsEffective(c, atMs))
    .sort((a, b) => b.effectiveFrom - a.effectiveFrom);
}
