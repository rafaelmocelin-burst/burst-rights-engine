import { describe, expect, it } from 'vitest';
import type { License } from '../src/entities.js';
import type { AssetId, LicenseId } from '../src/ids.js';
import { checkLicenses } from '../src/licensing.js';

const a = (s: string) => s as AssetId;
const l = (s: string) => s as LicenseId;

function license(overrides: Partial<License> = {}): License {
  return {
    id: l('lic-1'),
    assetId: a('asset-1'),
    territories: [],
    allowedUses: ['in_game_creation', 'streaming', 'purchase'],
    revenueSharePpm: 0n,
    validFrom: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const at = '2026-07-01T12:00:00Z';

describe('checkLicenses', () => {
  it('permits a usage covered by a worldwide, in-date license', () => {
    const result = checkLicenses({
      usageKind: 'purchase',
      occurredAt: at,
      territory: 'FI',
      assets: [{ assetId: a('asset-1'), licenses: [license()] }],
    });
    expect(result).toEqual({ permitted: true, violations: [] });
  });

  it('flags an asset with no license on file', () => {
    const result = checkLicenses({
      usageKind: 'purchase',
      occurredAt: at,
      territory: 'FI',
      assets: [{ assetId: a('asset-1'), licenses: [] }],
    });
    expect(result.permitted).toBe(false);
    expect(result.violations[0]).toMatchObject({ assetId: a('asset-1'), reason: 'no_license' });
  });

  it('flags disallowed uses, wrong territories, and out-of-window dates', () => {
    const notAllowed = checkLicenses({
      usageKind: 'gift',
      occurredAt: at,
      territory: 'FI',
      assets: [{ assetId: a('asset-1'), licenses: [license()] }],
    });
    expect(notAllowed.violations[0]?.reason).toBe('use_not_allowed');

    const wrongTerritory = checkLicenses({
      usageKind: 'purchase',
      occurredAt: at,
      territory: 'US',
      assets: [{ assetId: a('asset-1'), licenses: [license({ territories: ['FI', 'SE'] })] }],
    });
    expect(wrongTerritory.violations[0]?.reason).toBe('territory_not_allowed');

    const tooEarly = checkLicenses({
      usageKind: 'purchase',
      occurredAt: '2025-01-01T00:00:00Z',
      territory: 'FI',
      assets: [{ assetId: a('asset-1'), licenses: [license()] }],
    });
    expect(tooEarly.violations[0]?.reason).toBe('not_yet_valid');

    const expired = checkLicenses({
      usageKind: 'purchase',
      occurredAt: at,
      territory: 'FI',
      assets: [
        { assetId: a('asset-1'), licenses: [license({ validUntil: '2026-06-01T00:00:00Z' })] },
      ],
    });
    expect(expired.violations[0]?.reason).toBe('expired');
  });

  it('treats an unknown territory as unverifiable against a territory-restricted license', () => {
    const result = checkLicenses({
      usageKind: 'purchase',
      occurredAt: at,
      assets: [{ assetId: a('asset-1'), licenses: [license({ territories: ['FI'] })] }],
    });
    expect(result.permitted).toBe(false);
    expect(result.violations[0]?.reason).toBe('territory_not_allowed');
  });

  it('an unrestricted (worldwide) license clears an unknown territory', () => {
    const result = checkLicenses({
      usageKind: 'purchase',
      occurredAt: at,
      assets: [{ assetId: a('asset-1'), licenses: [license()] }],
    });
    expect(result.permitted).toBe(true);
  });

  it('passes when ANY license on the asset covers the usage', () => {
    const result = checkLicenses({
      usageKind: 'purchase',
      occurredAt: at,
      territory: 'US',
      assets: [
        {
          assetId: a('asset-1'),
          licenses: [
            license({ id: l('lic-eu'), territories: ['FI', 'SE'] }),
            license({ id: l('lic-us'), territories: ['US'] }),
          ],
        },
      ],
    });
    expect(result.permitted).toBe(true);
  });

  it('reports the most specific failure when every license fails', () => {
    const result = checkLicenses({
      usageKind: 'purchase',
      occurredAt: at,
      territory: 'US',
      assets: [
        {
          assetId: a('asset-1'),
          licenses: [
            license({ id: l('lic-a'), allowedUses: ['gift'] }), // use_not_allowed
            license({ id: l('lic-b'), validUntil: '2026-06-01T00:00:00Z' }), // expired
          ],
        },
      ],
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ reason: 'expired', licenseId: l('lic-b') });
  });

  it('maps play and stream usage onto the streaming license category', () => {
    for (const usageKind of ['play', 'stream'] as const) {
      const result = checkLicenses({
        usageKind,
        occurredAt: at,
        territory: 'FI',
        assets: [{ assetId: a('asset-1'), licenses: [license({ allowedUses: ['streaming'] })] }],
      });
      expect(result.permitted).toBe(true);
    }
  });

  it('reports every offending asset, not just the first', () => {
    const result = checkLicenses({
      usageKind: 'purchase',
      occurredAt: at,
      territory: 'FI',
      assets: [
        { assetId: a('asset-1'), licenses: [] },
        { assetId: a('asset-2'), licenses: [license({ assetId: a('asset-2') })] },
        { assetId: a('asset-3'), licenses: [] },
      ],
    });
    expect(result.violations.map((v) => v.assetId)).toEqual([a('asset-1'), a('asset-3')]);
  });
});
