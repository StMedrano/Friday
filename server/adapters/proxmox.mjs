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

export async function getProxmoxServices(config) {
  if (!config.enabled || !config.baseUrl || !config.tokenId || !config.tokenSecret) return []
  const resources = await getJson(config, '/cluster/resources?type=vm')
  return resources.map((vm) => ({
    id: `proxmox-${vm.type}-${vm.vmid}`,
    name: vm.name || `${vm.type?.toUpperCase() || 'VM'} ${vm.vmid}`,
    category: 'virtualization',
    host: vm.node || 'Proxmox',
    site: 'Site A',
    status: vm.status === 'running' ? 'online' : 'offline',
    detail: `${vm.type?.toUpperCase() || 'VM'} ${vm.vmid}`,
    updated: 'live',
  }))
}
