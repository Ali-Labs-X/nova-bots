// The engine's launch token.
//
// The engine writes the token to a file when it starts, but it re-mints the
// token when the profile reloads and the file keeps the old value until the
// next start; the container log has the token the engine serves with. Both are
// candidates: the file first, then the log's tokens, newest first. A token the
// engine refuses is dropped and the next one is tried. Nothing here logs or
// prints a token.

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const TOKEN_PATTERN = /token=([A-Za-z0-9._-]{16,})/g

// The tokens in a log, newest first and without repeats. The newest line of
// the log is the last one, so the tokens are read from the end.
export const tokensFromLog = text => {
  const found = []
  for (const match of String(text ?? '').matchAll(TOKEN_PATTERN)) found.push(match[1])
  const newest = []
  for (const token of found.reverse()) if (!newest.includes(token)) newest.push(token)
  return newest
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const defaultLog = (container, tail) => new Promise(resolve => {
  execFile('docker', ['logs', '--tail', String(tail), container], { timeout: 8000 }, (error, stdout, stderr) => {
    if (error && !stdout && !stderr) return resolve('')
    resolve(`${stdout}${stderr}`)
  })
})

const defaultRead = file => readFile(file, 'utf8')

export class LaunchTokenPool {
  constructor({ file, container, tail = 40, log = defaultLog, read = defaultRead, rounds = 4, backoffMs = [200, 600, 1500] } = {}) {
    this.file = file
    this.container = container
    this.tail = tail
    this.log = log
    this.read = read
    this.rounds = rounds
    this.backoffMs = backoffMs
    // The token the engine accepted last, tried first the next time.
    this.winner = null
  }

  async fileToken() {
    try {
      const value = (await this.read(this.file)).trim()
      return value || null
    } catch {
      return null
    }
  }

  async logTokens() {
    try {
      return tokensFromLog(await this.log(this.container, this.tail))
    } catch {
      return []
    }
  }

  // The candidates, the one that worked first.
  async candidates() {
    const list = []
    const file = await this.fileToken()
    if (file && file !== this.winner) list.push(file)
    for (const token of await this.logTokens()) if (token !== this.winner && !list.includes(token)) list.push(token)
    // The token the engine accepted last is the one to try first.
    if (this.winner) list.unshift(this.winner)
    return list
  }

  // The token to hand out where only one is wanted (the shared engine's own
  // tenant): the one that worked, else the first candidate.
  async current() {
    const candidates = await this.candidates()
    return this.winner && candidates.includes(this.winner) ? this.winner : candidates[0] ?? null
  }

  // The engine refused this token: it is not used again until a new one shows
  // up. The file token is the exception — a fresh file token becomes valid
  // again within minutes, so it stays in the list.
  invalidate(token) {
    if (!token || token === this.winner) this.winner = null
  }

  // Mint a cookie with the first candidate the engine accepts. When every
  // candidate is refused the pool waits and looks again, because the file
  // token is refreshed while the engine starts.
  async mint(engineUrl, host, mint) {
    for (let round = 0; round < this.rounds; round += 1) {
      for (const token of await this.candidates()) {
        const cookie = await mint(engineUrl, token, host)
        if (cookie) {
          this.winner = token
          return cookie
        }
      }
      if (round < this.rounds - 1) await sleep(this.backoffMs[round] ?? 500)
    }
    return null
  }
}
