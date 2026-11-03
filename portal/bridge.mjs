// The bridge from a browser to ONE engine.
//
// The caller (server.mjs) decides which engine a request may reach — from the
// portal session, on every request — and hands the bridge a target:
//
//   { key, url, cookie(host, { fresh }) -> 'dsh-auth-…=…' | null, invalidate() }
//
// The engine cookie is held by the portal and never by the browser:
//
//   * every engine cookie the browser presents is stripped before forwarding,
//     so a cookie from workspace A carries nothing into workspace B;
//   * the portal session cookie is stripped too — an isolated tenant controls
//     its own engine process, so nothing secret may be forwarded to it;
//   * the one cookie minted for the target engine is added;
//   * Set-Cookie headers for engine cookies or the portal session are dropped
//     from the engine's answer, and any engine cookie the browser still holds
//     from before is deleted.

import { request as httpRequest } from 'node:http'
import {
  clearEngineCookies,
  ENGINE_COOKIE_PREFIX,
  filterUpstreamSetCookies,
  upstreamCookieHeader,
} from './gate.mjs'

const presentedEngineCookie = (req) => String(req.headers.cookie ?? '')
  .split(';')
  .some(part => part.trim().startsWith(ENGINE_COOKIE_PREFIX))

// The engine only mints its browser cookie when the launch token is presented
// on the root path, so the portal mints it server-side, for the Host the
// browser used (the engine binds the cookie to that authority).
export const mintEngineCookie = (engineUrl, token, host, { timeoutMs = 8000 } = {}) => new Promise(resolve => {
  if (!token) return resolve(null)
  const upstream = new URL('/?token=' + encodeURIComponent(token), engineUrl)
  const request = httpRequest({
    hostname: upstream.hostname,
    port: upstream.port || 80,
    path: upstream.pathname + upstream.search,
    method: 'GET',
    headers: { host },
    timeout: timeoutMs,
  }, response => {
    response.resume()
    const cookies = [].concat(response.headers['set-cookie'] ?? [])
    const pair = cookies.map(value => String(value).split(';')[0].trim()).find(value => value.startsWith(ENGINE_COOKIE_PREFIX))
    resolve(pair ?? null)
  })
  request.on('timeout', () => request.destroy())
  request.on('error', () => resolve(null))
  request.end()
})

// A small cache of minted cookies, per engine and per Host. Nothing in it
// ever leaves the portal.
export class EngineCookieJar {
  constructor({ mint = mintEngineCookie } = {}) {
    this.mint = mint
    this.cookies = new Map()
  }

  async get({ key, url, host, token, fresh = false }) {
    const id = `${key}\u0000${host}`
    if (!fresh && this.cookies.has(id)) return this.cookies.get(id)
    const value = await this.mint(url, await token(), host)
    if (value) this.cookies.set(id, value)
    else this.cookies.delete(id)
    return value
  }

  invalidate(key) {
    for (const id of this.cookies.keys()) {
      if (id.startsWith(`${key}\u0000`)) this.cookies.delete(id)
    }
  }
}

// The app is served under /app; the engine lives at the root.
export const enginePath = (rawUrl) => {
  const url = new URL(rawUrl ?? '/', 'http://portal.local')
  const path = url.pathname === '/app' ? '/' : url.pathname.startsWith('/app/') ? url.pathname.slice(4) || '/' : url.pathname
  return path + url.search
}

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'proxy-authorization']

const upstreamHeaders = (req, engineCookie, { upgrade = false } = {}) => {
  const headers = { ...req.headers }
  for (const name of HOP_BY_HOP) if (!upgrade || (name !== 'connection' && name !== 'upgrade')) delete headers[name]
  delete headers['accept-encoding']
  // Credentials meant for the portal stay with the portal.
  delete headers.authorization
  delete headers['x-nova-bots-token']
  headers.host = req.headers.host ?? 'localhost'
  const cookie = upstreamCookieHeader(req.headers.cookie, engineCookie)
  if (cookie) headers.cookie = cookie
  else delete headers.cookie
  return headers
}

const responseCookies = (req, upstreamSetCookie) => {
  const kept = filterUpstreamSetCookies(upstreamSetCookie)
  // Engine cookies left in the browser from before the portal held them are
  // deleted, so the browser carries nothing a different workspace could see.
  return presentedEngineCookie(req) ? kept.concat(clearEngineCookies(req.headers.cookie)) : kept
}

const unavailable = (res, status, message) => {
  if (res.headersSent) return res.destroy()
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
  res.end(message)
}

// HTTP. A 401 from the engine means the minted cookie is no longer accepted
// (an engine whose cookie key changed): a GET/HEAD is retried once with a
// fresh cookie; a request with a body cannot be replayed, so it fails.
export const proxyHttp = async (req, res, target, { retried = false } = {}) => {
  const host = req.headers.host ?? 'localhost'
  const engineCookie = await target.cookie(host, { fresh: retried })
  if (!engineCookie) return unavailable(res, 503, 'The Nova Bots workspace is not reachable yet. Try again in a moment.')
  const upstream = new URL(enginePath(req.url), target.url)
  const replayable = req.method === 'GET' || req.method === 'HEAD'
  const request = httpRequest({
    hostname: upstream.hostname,
    port: upstream.port || 80,
    path: upstream.pathname + upstream.search,
    method: req.method,
    headers: upstreamHeaders(req, engineCookie),
  }, upstreamResponse => {
    if (upstreamResponse.statusCode === 401) {
      upstreamResponse.resume()
      target.invalidate?.()
      if (!retried && replayable) return proxyHttp(req, res, target, { retried: true })
      return unavailable(res, 503, 'The Nova Bots workspace did not accept the session. Reload the page.')
    }
    const headers = { ...upstreamResponse.headers }
    const cookies = responseCookies(req, headers['set-cookie'])
    delete headers['set-cookie']
    if (cookies.length) headers['set-cookie'] = cookies
    res.writeHead(upstreamResponse.statusCode ?? 502, headers)
    upstreamResponse.pipe(res)
  })
  request.on('error', () => unavailable(res, 502, 'The Nova Bots engine is not reachable.'))
  if (replayable) request.end()
  else req.pipe(request)
}

// WebSocket and other upgrades (the live feed). Same cookie rules as HTTP.
export const proxyUpgrade = async (req, socket, head, target, { onOpen, onClose, retried = false } = {}) => {
  const host = req.headers.host ?? 'localhost'
  const engineCookie = await target.cookie(host, { fresh: retried })
  if (!engineCookie) return socket.destroy()
  const upstream = new URL(enginePath(req.url), target.url)
  const request = httpRequest({
    hostname: upstream.hostname,
    port: upstream.port || 80,
    path: upstream.pathname + upstream.search,
    method: req.method,
    headers: upstreamHeaders(req, engineCookie, { upgrade: true }),
  })
  request.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
    const lines = []
    for (const [key, value] of Object.entries(upstreamResponse.headers)) {
      const name = key.toLowerCase()
      if (['transfer-encoding', 'content-length', 'connection', 'upgrade', 'set-cookie'].includes(name)) continue
      for (const item of [].concat(value)) lines.push(`${key}: ${item}`)
    }
    for (const cookie of responseCookies(req, upstreamResponse.headers['set-cookie'])) lines.push(`set-cookie: ${cookie}`)
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}${lines.length ? '\r\n' : ''}Connection: Upgrade\r\nUpgrade: ${upstreamResponse.headers.upgrade ?? 'websocket'}\r\n\r\n`)
    // Bytes the engine sent right after its 101 belong to the browser.
    if (upstreamHead?.length) socket.write(upstreamHead)
    upstreamSocket.on('error', () => socket.destroy())
    socket.on('error', () => upstreamSocket.destroy())
    socket.on('close', () => upstreamSocket.destroy())
    upstreamSocket.on('close', () => socket.end())
    upstreamSocket.pipe(socket).pipe(upstreamSocket)
    onOpen?.(socket)
    socket.once('close', () => onClose?.(socket))
  })
  request.on('response', upstreamResponse => {
    upstreamResponse.resume()
    if (upstreamResponse.statusCode === 401 && !retried) {
      target.invalidate?.()
      return proxyUpgrade(req, socket, head, target, { onOpen, onClose, retried: true })
    }
    socket.destroy()
  })
  request.on('error', () => socket.destroy())
  if (head?.length) request.write(head)
  request.end()
}
