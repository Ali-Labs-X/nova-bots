// One writer per plugin home. dsh Web and dsh Desktop share ~/.dsh, and each host keeps
// the team in memory and writes state.json whole, so two hosts at once would undo each
// other's changes. The first host to load takes `state.lock`; a second one only reads.
//
// The lock is a small JSON file (pid, its start, host, a random token) whose mtime the
// holder bumps on a timer. A live holder on the same host needs all of: a process that
// still runs under that pid, the same start, and a heartbeat fresher than `staleMs` — a
// crashed holder's pid may be reused by an unrelated process, and without the heartbeat
// check that process would hold the team read-only for as long as it runs. In a container
// that is the rule, not the exception: its processes are numbered from 1 again at every
// start. The token, not the pid, decides ownership: a holder that finds another token has
// lost the lock.
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'

export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error?.code === 'EPERM'
  }
}

// When the process under a pid started, counted from the system's own start. Only Linux
// tells; undefined elsewhere, and for a process that is gone.
export function pidStart(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // The second field, the name, is in parentheses and may hold spaces.
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
  } catch {
    return undefined
  }
}

export function homeLock(path, { staleMs = 60_000, beatMs = 15_000, host = hostname(), pid = process.pid, isAlive = pidAlive, startOf = pidStart, now = Date.now } = {}) {
  const token = randomUUID()
  const started = startOf(pid)
  let timer

  // undefined: no lock file; null: a file that does not parse (being written right now).
  const read = () => {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      return error?.code === 'ENOENT' ? undefined : null
    }
  }
  const age = () => {
    try { return now() - statSync(path).mtimeMs } catch { return Infinity }
  }
  const reused = (holder) => {
    const current = holder.started === undefined ? undefined : startOf(holder.pid)
    return current !== undefined && current !== holder.started
  }
  const live = (holder) => {
    if (holder === undefined) return false
    if (holder === null) return age() < staleMs
    if (holder.host === host) return holder.pid !== pid && isAlive(holder.pid) && !reused(holder) && age() < staleMs
    return age() < staleMs
  }
  const owns = () => read()?.token === token

  const beat = () => {
    if (!owns()) {
      stop()
      return
    }
    const time = new Date(now())
    try { utimesSync(path, time, time) } catch {}
  }
  const stop = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  // Take the lock if it is free or its holder is gone. Returns undefined when this
  // process holds it, else what the lock file says about the holder.
  function claim() {
    if (owns()) return undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        writeFileSync(path, JSON.stringify({ pid, started, host, token, since: now() }), { flag: 'wx' })
        stop()
        timer = setInterval(beat, beatMs)
        timer.unref?.()
        return undefined
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
      const holder = read()
      if (live(holder)) return holder ?? {}
      const current = read()
      const unchanged = holder === null
        ? current === null
        : holder?.token !== undefined
          ? current?.token === holder.token
          : JSON.stringify(current) === JSON.stringify(holder)
      if (unchanged) {
        try { unlinkSync(path) } catch {}
      }
    }
    return read() ?? {}
  }

  function release() {
    stop()
    if (owns()) {
      try { unlinkSync(path) } catch {}
    }
  }

  return { claim, owns, release, read }
}
