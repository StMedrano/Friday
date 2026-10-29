import https from 'node:https'

function getJson(config, path) {
  return new Promise((resolve, reject) => {
    const base = new URL(config.baseUrl)
    const request = https.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port || 8006,
      path: `${base.pathname.replace(/\/$/, '')}/api2/json${path}`,
      method: 'GET',
      rejectUnauthorized: config.rejectUnauthorized,
      headers: { Authorization: `PVEAPIToken=${config.tokenId}=${config.tokenSecret}` },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 400) return reject(new Error(`Proxmox API ${response.statusCode}`))
        try { resolve(JSON.parse(body).data ?? []) } catch (error) { reject(error) }
      })
    })
    request.on('error', reject)
    request.setTimeout(5000, () => request.destroy(new Error('Proxmox API timeout')))
    request.end()
  })
}

// Host memory or swap above these shares marks the node degraded, which
// opens a monitoring incident before the host's OOM killer has to act.
const MEMORY_WARN = 0.85
const SWAP_WARN = 0.8

const share = (used, total) => Number.isFinite(used) && Number.isFinite(total) && total > 0 ? used / total : null
const percent = (value) => `${Math.round(value * 100)}%`

async function getNodeServices(config, requestImpl) {
  let nodes
  try { nodes = await requestImpl(config, '/cluster/resources?type=node') } catch { return [] }
  if (!Array.isArray(nodes)) return []
  const services = []
  for (const node of nodes.filter((item) => item?.type === 'node' && typeof item.node === 'string' && item.node)) {
    const service = {
      id: `proxmox-node-${node.node}`, name: `Proxmox host ${node.node}`, category: 'host', host: node.node,
      site: config.site || 'Site A', status: 'online', detail: '', updated: 'live',
    }
    if (node.status !== 'online') {
      services.push({ ...service, status: 'offline', detail: 'Node offline' })
      continue
    }
    let status = null
    try { status = await requestImpl(config, `/nodes/${encodeURIComponent(node.node)}/status`) } catch { status = null }
    const memory = status?.memory
    const memoryShare = memory
      ? share(Number.isFinite(memory.available) ? memory.total - memory.available : memory.used, memory.total)
      : share(node.mem, node.maxmem)
    const swapShare = status?.swap ? share(status.swap.used, status.swap.total) : null
    const pressured = (memoryShare !== null && memoryShare >= MEMORY_WARN) || (swapShare !== null && swapShare >= SWAP_WARN)
    services.push({
      ...service,
      status: pressured ? 'degraded' : 'online',
      detail: `Memory ${memoryShare === null ? 'unknown' : `${percent(memoryShare)} used`} · swap ${swapShare === null ? 'unknown' : `${percent(swapShare)} used`}`,
    })
  }
  return services
}

export async function getProxmoxServices(config, requestImpl = getJson) {
  if (!config.enabled || !config.baseUrl || !config.tokenId || !config.tokenSecret) return []
  const resources = await requestImpl(config, '/cluster/resources?type=vm')
  const nodes = await getNodeServices(config, requestImpl)
  return [...resources.map((vm) => ({
    id: `proxmox-${vm.type}-${vm.vmid}`,
    name: vm.name || `${vm.type?.toUpperCase() || 'VM'} ${vm.vmid}`,
    category: 'virtualization',
    host: vm.node || 'Proxmox',
    site: config.site || 'Site A',
    status: vm.status === 'running' ? 'online' : 'offline',
    detail: `${vm.type?.toUpperCase() || 'VM'} ${vm.vmid}`,
    updated: 'live',
  })), ...nodes]
}
