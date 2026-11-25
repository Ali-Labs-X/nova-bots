// After a reboot the portal can be up before Postgres. Failing then used up
// systemd's start limit, so the portal waits instead.

const STARTING = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE', '57P03'])

export const untilDatabase = async (work, {
  timeoutMs = 180000,
  delayMs = 2000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
  log = console.warn,
} = {}) => {
  const until = now() + timeoutMs
  for (;;) {
    try {
      return await work()
    } catch (error) {
      if (!STARTING.has(error?.code) || now() >= until) throw error
      log(`portal: the database is not ready (${error.code}); trying again`)
      await sleep(delayMs)
    }
  }
}
