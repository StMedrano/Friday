import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import NotConnected from './NotConnected'
import { fetchFridayAgentActivity, fetchFridayAgents, type FridayAgent, type FridayAgentActivityEvent } from '../lib/api'

type State = { state: 'loading' } | { state: 'unavailable' } | { state: 'ok'; agents: FridayAgent[]; activity: FridayAgentActivityEvent[] }

function scopeHosts(agent: FridayAgent) {
  const hosts = (agent.scope as { hosts?: unknown })?.hosts
  return Array.isArray(hosts) ? hosts.filter((host): host is string => typeof host === 'string' && host.trim() !== '') : []
}

/** Agents whose declared scope covers any of these host labels (case-insensitive, either name containing the other). */
export function agentsOnDuty(agents: FridayAgent[], hosts: string[]) {
  const labels = hosts.map((host) => host.toLowerCase())
  return agents.filter((agent) => agent.enabled && scopeHosts(agent).some((scope) => {
    const value = scope.toLowerCase()
    return labels.some((label) => label.includes(value) || value.includes(label))
  }))
}

function when(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * Which registered agent covers the visible hosts, from each agent's declared
 * scope in the Git-backed registry, plus its last answer when the activity log is on.
 */
export default function AgentOnDuty({ hosts }: { hosts: string[] }) {
  const [data, setData] = useState<State>({ state: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetchFridayAgents(controller.signal),
      fetchFridayAgentActivity(controller.signal).catch(() => ({ state: 'unavailable' as const })),
    ]).then(([agents, activity]) => {
      if (!controller.signal.aborted) setData({ state: 'ok', agents, activity: activity.state === 'ok' ? activity.events : [] })
    }).catch(() => { if (!controller.signal.aborted) setData({ state: 'unavailable' }) })
    return () => controller.abort()
  }, [])

  if (data.state !== 'ok') return <NotConnected title="Agent on duty" detail="Which agent watches this infrastructure appears once the agent registry is connected."/>
  const onDuty = agentsOnDuty(data.agents, hosts)
  const lead = onDuty[0]
  const last = lead ? data.activity.find((event) => event.agentId === lead.id && event.outcome === 'answered') : undefined
  return <div className={`fx-stat fx-duty ${lead ? "healthy" : "attention"}`} role="group" aria-label="Agent on duty">
    <span className="fx-stat-icon"><Bot size={17} aria-hidden="true"/></span>
    <small>Agent on duty</small>
    <strong>{lead ? lead.name : 'None'}<em>{lead ? (onDuty.length > 1 ? ` +${onDuty.length - 1} more` : '') : 'scoped here'}</em></strong>
    <span className="fx-stat-note">{lead
      ? `Scope: ${scopeHosts(lead).join(', ')}${last ? ` · last answered ${when(last.at)}` : ''}`
      : 'No enabled agent declares these hosts in its scope.'}</span>
  </div>
}
