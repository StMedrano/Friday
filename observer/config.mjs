export function getObserverConfig(env = process.env) {
  return {
    port: Number(env.FRIDAY_OBSERVER_PORT || 3199),
    bindAddress: env.FRIDAY_OBSERVER_BIND_ADDRESS || '127.0.0.1',
    token: env.FRIDAY_OBSERVER_TOKEN || '',
    hostName: env.FRIDAY_OBSERVER_HOST_NAME || 'VM 100',
    dockerSocketPath: env.FRIDAY_OBSERVER_DOCKER_SOCKET || '/var/run/docker.sock',
    allowedLabelKeys: String(env.FRIDAY_OBSERVER_ALLOWED_LABEL_KEYS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  }
}
