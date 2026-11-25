// What the portal takes from a request before it trusts anything in it.

import { readFileSync } from 'node:fs'
import { BlockList, isIP } from 'node:net'

// The subnets of Docker's own bridges, from the kernel's route table. The
// tenants' bridge has a name of its own, so it is not among them. (The portal's
// sandbox leaves no netlink socket, so os.networkInterfaces() fails there.)
export const dockerBridges = (routes) => String(routes).split('\n').flatMap((line) => {
  const [name, destination, , , , , , mask] = line.split('\t')
  if (!/^(docker0|br-[0-9a-f]{12})$/.test(name) || !/^[0-9A-F]{8}$/.test(destination) || !/^[0-9A-F]{8}$/.test(mask ?? '')) return []
  const bytes = Buffer.from(destination, 'hex').reverse()
  const bits = Buffer.from(mask, 'hex').reduce((sum, byte) => sum + byte.toString(2).replaceAll('0', '').length, 0)
  return bits === 0 ? [] : [`${bytes.join('.')}/${bits}`]
})

// The hops in front of the portal: the tunnel and nginx, on the loopback and
// on Docker's bridges, or anywhere in Docker's usual range when the bridges
// are not known. More can be named in NOVA_TRUSTED_PROXIES (addresses or CIDR
// ranges, comma separated).
export const trustedProxies = ({ bridges = [], extra = process.env.NOVA_TRUSTED_PROXIES } = {}) => {
  const trusted = new BlockList()
  const docker = bridges.length ? bridges : ['172.16.0.0/12']
  for (const range of ['127.0.0.0/8', '::1/128', ...docker, ...String(extra ?? '').split(',')]) {
    const [address, bits] = range.trim().split('/')
    const family = isIP(address)
    if (family) trusted.addSubnet(address, Number(bits ?? (family === 4 ? 32 : 128)), `ipv${family}`)
  }
  return trusted
}

// The web front end's network can be made anew while the portal runs.
const REFRESH_MS = 30000
let current
let currentAt = -Infinity
const currentProxies = () => {
  if (Date.now() - currentAt < REFRESH_MS) return current
  let bridges = []
  try { bridges = dockerBridges(readFileSync('/proc/net/route', 'utf8')) } catch { /* not Linux */ }
  currentAt = Date.now()
  current = trustedProxies({ bridges })
  return current
}

const plain = address => String(address ?? '').trim().replace(/^::ffff:(?=\d+\.)/i, '')

// Each hop adds the address it saw at the end, so the list is read from there
// until a hop that is not ours. What stands before that the visitor wrote.
export const clientIp = (req, trusted = currentProxies()) => {
  let address = plain(req.socket.remoteAddress)
  const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map(plain)
  while (isIP(address) && trusted.check(address, `ipv${isIP(address)}`) && hops.length) {
    const next = hops.pop()
    if (!isIP(next)) break
    address = next
  }
  return address || 'unknown'
}

// What a limit counts: one IPv6 line has a whole /64 to choose addresses from.
export const rateKey = (address) => {
  if (isIP(address) !== 6) return address
  const [head, tail] = address.split('%')[0].split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
  return `${groups.slice(0, 4).map(group => Number.parseInt(group, 16).toString(16)).join(':')}::/64`
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
