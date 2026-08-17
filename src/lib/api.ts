import { useEffect, useState } from 'react'
import type { ActivityItem, AlertItem, ResourceMetric, Service, Site } from './infrastructure'
import { activities, alerts, resources, services, sites } from '../data/mock'

export type FridayOverview = {
  mode: 'mock' | 'live'
  generatedAt?: string
  sites: Site[]
  services: Service[]
  alerts: AlertItem[]
  resources: ResourceMetric[]
  activities: ActivityItem[]
  integrations?: Array<{ id: string; enabled: boolean; mode: string }>
}

const fallback: FridayOverview = {
  mode: 'mock',
  sites,
  services,
  alerts,
  resources,
  activities,
}

export function useFridayOverview() {
  const [overview, setOverview] = useState<FridayOverview>(fallback)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/overview', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Friday API ${response.status}`)
        return response.json()
      })
      .then((data: FridayOverview) => {
        setOverview(data)
        setConnected(true)
      })
      .catch(() => setConnected(false))
    return () => controller.abort()
  }, [])

  return { overview, connected }
}

export async function previewFridayCommand(message: string) {
  const response = await fetch('/api/commands/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.reason || 'Command preview failed')
  return body as { accepted: boolean; command: string; message: string; mode: 'preview' }
}
