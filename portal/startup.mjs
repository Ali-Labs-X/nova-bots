// After a reboot the portal can be up before Postgres. Failing then used up
// systemd's start limit, so the portal waits instead.

const STARTING = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE', 'EAI_AGAIN', '57P01', '57P02', '57P03'])
// The driver gives no code when the server drops the connection.
const starting = error => STARTING.has(error?.code) || (!error?.code && /^Connection terminated/.test(error?.message ?? ''))

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
      if (!starting(error) || now() >= until) throw error
      log(`portal: the database is not ready (${error.code ?? error.message}); trying again`)
      await sleep(delayMs)
    }
  }
}
