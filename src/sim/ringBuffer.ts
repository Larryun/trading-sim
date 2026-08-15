/**
 * Fixed-capacity circular buffer of numbers. Pushing is O(1) and never
 * reallocates, so a long-running simulation stays flat on memory/GC instead of
 * churning through `slice()` calls on ever-growing arrays.
 *
 * `startIndex` is the absolute index of the oldest retained sample, so callers
 * can align aggregations (e.g. OHLC bars) to stable boundaries across trims.
 */
export class RingBuffer {
  private buf: Float64Array;
  private cap: number;
  private head = 0; // next write position
  private filled = 0; // number of valid elements currently stored
  private total = 0; // total pushes over all time (absolute count)

  constructor(capacity: number, initial?: number) {
    this.cap = capacity;
    this.buf = new Float64Array(capacity);
    if (initial !== undefined) this.push(initial);
  }

  push(value: number): void {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % this.cap;
    if (this.filled < this.cap) this.filled++;
    this.total++;
  }

  get size(): number {
    return this.filled;
  }

  /** Absolute index of the oldest retained sample. */
  get startIndex(): number {
    return this.total - this.filled;
  }

  get last(): number {
    return this.buf[(this.head - 1 + this.cap) % this.cap];
  }

  /**
   * The most recent `n` samples in chronological order, plus the absolute index
   * of the first returned sample. Copies at most `n` values.
   */
  window(n: number): { data: number[]; startIndex: number } {
    const len = Math.min(n, this.filled);
    const data = new Array<number>(len);
    const start = (this.head - len + this.cap * 2) % this.cap;
    for (let i = 0; i < len; i++) data[i] = this.buf[(start + i) % this.cap];
    return { data, startIndex: this.total - len };
  }
}
