import type { License, LicenseUse, UsageKind } from './entities.js';
import type { AssetId } from './ids.js';

/**
 * License enforcement (Phase 5): check a usage against the licenses covering
 * the assets in a creation's recipe.
 *
 * Policy: violations are **flagged, never silently dropped**, and the check is
 * separate from the money math so an operator decides what a violation means
 * (block the payout, accrue but withhold, or accrue and alert). The engine's
 * job is to make the fact undeniable and auditable, not to guess the response.
 */

export type ViolationReason =
  | 'no_license'
  | 'use_not_allowed'
  | 'territory_not_allowed'
  | 'not_yet_valid'
  | 'expired';

export interface LicenseViolation {
  readonly assetId: AssetId;
  readonly licenseId?: string;
  readonly reason: ViolationReason;
  readonly detail: string;
}

export interface LicenseCheckInput {
  readonly usageKind: UsageKind;
  readonly occurredAt: string;
  /** ISO 3166-1 alpha-2; undefined means unknown territory, which cannot be verified. */
  readonly territory?: string;
  /** Assets used by the creation, each with the licenses on file for it. */
  readonly assets: readonly { assetId: AssetId; licenses: readonly License[] }[];
}

export interface LicenseCheckResult {
  readonly permitted: boolean;
  readonly violations: readonly LicenseViolation[];
}

/** Usage kinds map onto license use categories; 'stream' and 'play' both count as streaming use. */
const USE_FOR_USAGE: Record<UsageKind, LicenseUse> = {
  play: 'streaming',
  stream: 'streaming',
  purchase: 'purchase',
  gift: 'gift',
};

function instant(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RangeError(`Invalid ISO 8601 instant: ${iso}`);
  return t;
}

/**
 * An asset passes if ANY license on file covers the usage — assets legitimately
 * carry several licenses (per territory, per use). The reported violation for a
 * failing asset is the one from its "closest" license, ranked by how specific
 * the failure is, so the operator sees the most actionable reason.
 */
const REASON_PRIORITY: Record<ViolationReason, number> = {
  expired: 0,
  not_yet_valid: 1,
  territory_not_allowed: 2,
  use_not_allowed: 3,
  no_license: 4,
};

function checkOne(
  license: License,
  requiredUse: LicenseUse,
  at: number,
  territory: string | undefined,
): LicenseViolation | undefined {
  const base = { assetId: license.assetId, licenseId: license.id };
  if (!license.allowedUses.includes(requiredUse)) {
    return {
      ...base,
      reason: 'use_not_allowed',
      detail: `License permits [${license.allowedUses.join(', ')}], not '${requiredUse}'`,
    };
  }
  if (at < instant(license.validFrom)) {
    return { ...base, reason: 'not_yet_valid', detail: `License starts ${license.validFrom}` };
  }
  if (license.validUntil !== undefined && at > instant(license.validUntil)) {
    return { ...base, reason: 'expired', detail: `License ended ${license.validUntil}` };
  }
  // An empty territory list means worldwide. A known-restricted license cannot be
  // cleared for an unknown territory — absence of data is not permission.
  if (license.territories.length > 0) {
    if (territory === undefined) {
      return {
        ...base,
        reason: 'territory_not_allowed',
        detail: `License is limited to [${license.territories.join(', ')}] and the usage territory is unknown`,
      };
    }
    if (!license.territories.includes(territory)) {
      return {
        ...base,
        reason: 'territory_not_allowed',
        detail: `License covers [${license.territories.join(', ')}], not '${territory}'`,
      };
    }
  }
  return undefined;
}

export function checkLicenses(input: LicenseCheckInput): LicenseCheckResult {
  const requiredUse = USE_FOR_USAGE[input.usageKind];
  const at = instant(input.occurredAt);
  const violations: LicenseViolation[] = [];

  for (const { assetId, licenses } of input.assets) {
    if (licenses.length === 0) {
      violations.push({
        assetId,
        reason: 'no_license',
        detail: 'No license on file for this asset',
      });
      continue;
    }
    const failures: LicenseViolation[] = [];
    let permitted = false;
    for (const license of licenses) {
      const failure = checkOne(license, requiredUse, at, input.territory);
      if (failure === undefined) {
        permitted = true;
        break;
      }
      failures.push(failure);
    }
    if (!permitted) {
      failures.sort((a, b) => REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason]);
      violations.push(failures[0]!);
    }
  }

  return { permitted: violations.length === 0, violations };
}
