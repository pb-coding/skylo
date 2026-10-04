/** Seeded PRNG with explicit state: simulation clones never share randomness. */
export class SeededRandom {
  private value: number;

  constructor(seed: string | number) {
    const input = String(seed);
    let value = 2166136261;
    for (let index = 0; index < input.length; index++) {
      value = Math.imul(value ^ input.charCodeAt(index), 16777619);
    }
    this.value = value >>> 0;
  }

  next(): number {
    // Mulberry32; no clock, ambient random source or process state involved.
    this.value = (this.value + 0x6d2b79f5) >>> 0;
    let mixed = this.value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  }

  snapshot(): number { return this.value; }

  clone(): SeededRandom {
    const copy = new SeededRandom(0);
    copy.value = this.value;
    return copy;
  }
}

export function createRandom(seed: string | number): () => number {
  const random = new SeededRandom(seed);
  return () => random.next();
}

export function shuffle<T>(items: T[], random: SeededRandom): void {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(random.next() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
}
