/**
 * Exact integer distribution of a ppm (or any integer) total across weighted
 * keys — the same largest-remainder discipline as money allocation, reused by
 * the attribution engine so every derived split still sums exactly.
 */

export interface WeightedKey {
  readonly key: string;
  /** Non-negative; at least one weight in the set must be positive. */
  readonly weight: bigint;
}

/**
 * Distribute `total` across keys proportionally to weight, exactly:
 * results are integers, sum to exactly `total`, and are deterministic and
 * independent of input order (largest remainder; ties broken by key).
 */
export function distributeExact(total: bigint, weights: readonly WeightedKey[]): Map<string, bigint> {
  if (weights.length === 0) throw new RangeError('distributeExact: empty weight set');
  if (total < 0n) throw new RangeError('distributeExact: total must be >= 0');
  let weightSum = 0n;
  const seen = new Set<string>();
  for (const w of weights) {
    if (w.weight < 0n) throw new RangeError(`distributeExact: negative weight for ${w.key}`);
    if (seen.has(w.key)) throw new RangeError(`distributeExact: duplicate key ${w.key}`);
    seen.add(w.key);
    weightSum += w.weight;
  }
  if (weightSum === 0n) throw new RangeError('distributeExact: all weights are zero');

  const ordered = [...weights].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const floors = ordered.map((w) => {
    const raw = total * w.weight;
    return { key: w.key, floor: raw / weightSum, rem: raw % weightSum };
  });

  let leftover = total - floors.reduce((acc, f) => acc + f.floor, 0n);
  const byRemainder = [...floors].sort((a, b) => {
    if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
    return a.key < b.key ? -1 : 1;
  });

  const result = new Map<string, bigint>(floors.map((f) => [f.key, f.floor]));
  for (const f of byRemainder) {
    if (leftover === 0n) break;
    result.set(f.key, result.get(f.key)! + 1n);
    leftover -= 1n;
  }
  return result;
}
