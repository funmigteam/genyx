type Logger = { info: (data: unknown, message?: string) => void; error: (data: unknown, message?: string) => void };
export function createWorker(name: string, intervalMs: number, job: () => Promise<void>, log: Logger) {
  let stopped = false, active: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const state = { name, running: false, lastStartedAt: null as string | null, lastCompletedAt: null as string | null, failures: 0 };
  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (active) return active;
    state.running = true; state.lastStartedAt = new Date().toISOString();
    active = Promise.resolve().then(job).then(() => { state.lastCompletedAt = new Date().toISOString(); state.failures = 0; }).catch(() => {
      state.failures++;
      // Never put provider errors (which can contain credentials) in status or logs.
      log.error({ worker: name, failures: state.failures }, 'Worker iteration failed');
    }).finally(() => { state.running = false; active = undefined; });
    return active;
  };
  const loop = async () => { await tick(); if (!stopped) { timer = setTimeout(loop, intervalMs); timer.unref(); } };
  return {
    state,
    tick,
    start() { if (!timer && !active && !stopped) { log.info({ worker: name }, 'Worker started'); void loop(); } },
    async stop() { stopped = true; if (timer) clearTimeout(timer); await active; },
  };
}
