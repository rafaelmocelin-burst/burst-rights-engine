/**
 * Versioned rule registry.
 *
 * Attribution and royalty logic MUST be pure, deterministic, and versioned so that
 * any historical calculation can be reproduced exactly (charter §6). Every ledger
 * entry records the rule version that produced it. Rules are NEVER edited in place:
 * a behaviour change ships as a new version, and old versions remain runnable.
 */

export interface RuleVersion<Input, Output> {
  /** Immutable identifier, e.g. 'attribution/v1'. Recorded on every ledger entry it produces. */
  readonly id: string;
  /** Pure function: same input → same output, no I/O, no clock, no randomness. */
  readonly apply: (input: Input) => Output;
}

export class UnknownRuleVersionError extends Error {
  constructor(id: string) {
    super(`Unknown rule version: ${id}`);
    this.name = 'UnknownRuleVersionError';
  }
}

export class RuleRegistry<Input, Output> {
  private readonly versions = new Map<string, RuleVersion<Input, Output>>();

  register(rule: RuleVersion<Input, Output>): void {
    if (this.versions.has(rule.id)) {
      throw new Error(`Rule version already registered (versions are immutable): ${rule.id}`);
    }
    this.versions.set(rule.id, rule);
  }

  get(id: string): RuleVersion<Input, Output> {
    const rule = this.versions.get(id);
    if (!rule) throw new UnknownRuleVersionError(id);
    return rule;
  }

  has(id: string): boolean {
    return this.versions.has(id);
  }
}
