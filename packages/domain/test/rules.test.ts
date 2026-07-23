import { describe, expect, it } from 'vitest';
import { RuleRegistry, UnknownRuleVersionError } from '../src/rules.js';

describe('RuleRegistry', () => {
  it('registers and retrieves versioned rules', () => {
    const registry = new RuleRegistry<number, number>();
    registry.register({ id: 'double/v1', apply: (n) => n * 2 });
    expect(registry.get('double/v1').apply(21)).toBe(42);
    expect(registry.has('double/v1')).toBe(true);
    expect(registry.has('double/v2')).toBe(false);
  });

  it('refuses to overwrite a registered version — versions are immutable', () => {
    const registry = new RuleRegistry<number, number>();
    registry.register({ id: 'double/v1', apply: (n) => n * 2 });
    expect(() => registry.register({ id: 'double/v1', apply: (n) => n * 3 })).toThrow(
      /already registered/,
    );
  });

  it('throws on unknown versions instead of silently falling back', () => {
    const registry = new RuleRegistry<number, number>();
    expect(() => registry.get('nope/v9')).toThrow(UnknownRuleVersionError);
  });
});
