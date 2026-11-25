// What the portal takes from a request before it trusts anything in it.

import { BlockList, isIP } from 'node:net'

// The hops in front of the portal: the tunnel and nginx, on the loopback and
// Docker's bridges. More can be named in NOVA_TRUSTED_PROXIES (addresses or
// CIDR ranges, comma separated).
const trustedProxies = (extra = process.env.NOVA_TRUSTED_PROXIES) => {
  const trusted = new BlockList()
  for (const range of ['127.0.0.0/8', '::1/128', '172.16.0.0/12', ...String(extra ?? '').split(',')]) {
    const [address, bits] = range.trim().split('/')
    const family = isIP(address)
    if (family) trusted.addSubnet(address, Number(bits ?? (family === 4 ? 32 : 128)), `ipv${family}`)
  }
  return trusted
}
const TRUSTED = trustedProxies()

const plain = address => String(address ?? '').trim().replace(/^::ffff:(?=\d+\.)/i, '')

// Each hop adds the address it saw at the end, so the list is read from there
// until a hop that is not ours. What stands before that the visitor wrote.
export const clientIp = (req) => {
  let address = plain(req.socket.remoteAddress)
  const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map(plain)
  while (isIP(address) && TRUSTED.check(address, `ipv${isIP(address)}`) && hops.length) {
    const next = hops.pop()
    if (!isIP(next)) break
    address = next
  }
  return address || 'unknown'
}

export class BodyTooLarge extends Error {}

// The account API takes short forms only.
export const readBody = (req, limit = 64 * 1024) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  req.on('data', chunk => {
    size += chunk.length
    if (size > limit) {
      chunks.length = 0
      reject(new BodyTooLarge('The request is too large.'))
    } else chunks.push(chunk)
  })
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', reject)
})

// Only the path counts: a request line may hold a whole address, or a path
// that a URL parser would read as a host.
export const requestUrl = (raw) => {
  const path = String(raw ?? '/')
  return new URL(`http://portal.local/${path.startsWith('/') ? path.replace(/^[/\\]+/, '') : ''}`)
}
