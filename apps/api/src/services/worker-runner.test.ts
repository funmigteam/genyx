import { describe, it, expect, vi } from 'vitest';
import { createWorker } from './worker-runner.js';
const logger = { info: vi.fn(), error: vi.fn() };
describe('worker lifecycle', () => {
  it('does not overlap iterations and drains on shutdown', async () => {
    let finish!: () => void;
    const job = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const worker = createWorker('test', 1000, job, logger);
    const first = worker.tick(), second = worker.tick(); await Promise.resolve();
    expect(job).toHaveBeenCalledTimes(1);
    const stopped = worker.stop(); finish(); await Promise.all([first, second, stopped]);
    await worker.tick(); expect(job).toHaveBeenCalledTimes(1); expect(worker.state.running).toBe(false);
  });
  it('records failures without leaking error details and recovers', async () => {
    const job = vi.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValue(undefined);
    const worker = createWorker('test', 1000, job, logger);
    await worker.tick(); expect(worker.state.failures).toBe(1);
    await worker.tick(); expect(worker.state.failures).toBe(0); expect(worker.state.lastCompletedAt).not.toBeNull();
  });
});
