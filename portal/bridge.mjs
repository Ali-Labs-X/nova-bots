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
  constructor({ mint = mintEngineCookie, maxAgeMs = 60000 } = {}) {
    this.mint = mint
    this.maxAgeMs = maxAgeMs
    this.cookies = new Map()
  }

  // `mint` hands back a cookie for the engine, trying its own candidates;
  // `token` is the single-token way, kept for the engines that have one.
  async get({ key, url, host, token, mint, fresh = false, now = () => Date.now() }) {
    const id = `${key}\u0000${host}`
    const cached = this.cookies.get(id)
    if (!fresh && cached && (this.maxAgeMs <= 0 || now() - cached.at <= this.maxAgeMs)) return cached.value
    const value = mint ? await mint(url, host) : token ? await this.mint(url, await token(), host) : null
    if (value) this.cookies.set(id, { value, at: now() })
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

const unavailable = (res, status, message, extra = {}) => {
  if (res.headersSent) return res.destroy()
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8', ...extra })
  res.end(message)
}

// The engine's page starts with <base href="./">: without the trailing slash
// the browser resolves its scripts to the portal's root and the app stays
// blank. /app answers with a redirect to /app/ instead.
export const redirectToApp = (req, res) => {
  const url = new URL(req.url ?? '/', 'http://portal.local')
  const location = url.search ? `/app/?${url.search}` : '/app/'
  res.writeHead(302, { location, 'cache-control': 'no-store' })
  res.end()
}

// A request with a body can be sent again with a fresh cookie only if its
// body was kept. A body that is too large, or one that comes without a
// length, is streamed as it is and cannot be replayed.
const REPLAY_LIMIT = 1 << 20

const requestBody = async req => {
  if (req.method === 'GET' || req.method === 'HEAD') return { body: null, replayable: true }
  const length = Number(req.headers['content-length'] ?? NaN)
  if (!Number.isFinite(length) || length < 0 || length > REPLAY_LIMIT) return { body: null, replayable: false }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return { body: Buffer.concat(chunks), replayable: true }
}

// HTTP. A 401 from the engine means the minted cookie is no longer accepted
// (an engine whose cookie key changed): the request is sent again with a
// fresh cookie when it can be replayed; one that cannot be replayed is
// answered with the status the client can act on.
export const proxyHttp = async (req, res, target, { retried = false, payload } = {}) => {
  const host = req.headers.host ?? 'localhost'
  const engineCookie = await target.cookie(host, { fresh: retried })
  if (!engineCookie) return unavailable(res, 503, 'The Nova Bots workspace is not reachable yet. Try again in a moment.', { 'retry-after': '2' })
  const upstream = new URL(enginePath(req.url), target.url)
  const { body, replayable } = payload ?? await requestBody(req)
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
      if (!retried && replayable) return proxyHttp(req, res, target, { retried: true, payload: { body, replayable } })
      return unavailable(res, 401, 'The Nova Bots workspace refused the session. Reload the page and sign in again.')
    }
    const headers = { ...upstreamResponse.headers }
    // Hop-by-hop headers describe the engine's connection to the portal, not
    // the portal's connection to the client: forwarding them (keep-alive on a
    // connection the client asked to close) desynchronises a keep-alive pool
    // in front of the portal and every other request fails with a 400.
    for (const name of HOP_BY_HOP) delete headers[name]
    const cookies = responseCookies(req, headers['set-cookie'])
    delete headers['set-cookie']
    if (cookies.length) headers['set-cookie'] = cookies
    res.writeHead(upstreamResponse.statusCode ?? 502, headers)
    upstreamResponse.pipe(res)
  })
  request.on('error', () => unavailable(res, 502, 'The Nova Bots engine is not reachable.'))
  if (replayable) request.end(body ?? undefined)
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
