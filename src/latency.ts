const MAX_SAMPLES = 500;

/** Fixed-size ring buffer of MCP round-trip latencies, for GET /health. */
export class LatencyTracker {
  private samples: number[] = [];
  private cursor = 0;
  private count = 0;

  record(ms: number): void {
    if (this.samples.length < MAX_SAMPLES) {
      this.samples.push(ms);
    } else {
      this.samples[this.cursor] = ms;
      this.cursor = (this.cursor + 1) % MAX_SAMPLES;
    }
    this.count += 1;
  }

  stats(): { count: number; p50: number; p95: number; max: number } {
    if (this.samples.length === 0) return { count: 0, p50: 0, p95: 0, max: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return {
      count: this.count,
      p50: pick(0.5),
      p95: pick(0.95),
      max: sorted[sorted.length - 1],
    };
  }
}
