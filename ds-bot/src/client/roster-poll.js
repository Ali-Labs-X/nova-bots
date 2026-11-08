// The roster poll asks the Bot API for the team every 1.5 s, and every 10 s
// while the window is hidden.
export const POLL_DELAY = 1500
export const POLL_DELAY_HIDDEN = 10000

// A failed start is reported after this many answers in a row that are not the
// roster, so a single refused request does not frighten the user.
export const FAILED_START_MISSES = 10

// The status the Bot API answered with, or '' when the answer carried none: a
// network miss is the host reconnecting, not a start-up failure (#516).
export const failureStatus = error => {
  const code = typeof error?.code === 'string' ? error.code : ''
  const match = /^HTTP_(\d{3})$/.exec(code)
  return match ? `HTTP ${match[1]}` : ''
}

// The poll itself. `pull` answers the roster or throws; `onStartFailed` gets
// the status of a failed start, `onRecovered` runs when the roster is back.
export const startRosterPoll = ({ pull, onStartFailed, onRecovered, isHidden = () => false, schedule = setTimeout, cancel = clearTimeout, log = () => {} }) => {
  let stopped = false
  let running = false
  let timer
  let misses = 0
  const loop = async () => {
    cancel(timer)
    if (running || stopped) return
    running = true
    try {
      await pull()
      misses = 0
      onRecovered()
    } catch (error) {
      if (!stopped) {
        log(error)
        const status = failureStatus(error)
        if (status) {
          misses += 1
          if (misses >= FAILED_START_MISSES) onStartFailed(status)
        }
      }
    } finally { running = false }
    if (!stopped) timer = schedule(loop, isHidden() ? POLL_DELAY_HIDDEN : POLL_DELAY)
  }
  return {
    start: () => void loop(),
    wake: () => { if (!isHidden()) void loop() },
    stop: () => { stopped = true; cancel(timer) },
  }
}
