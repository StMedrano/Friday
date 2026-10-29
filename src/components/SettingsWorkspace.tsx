import { useEffect, useState } from 'react'
import { Lock, Settings, ShieldCheck } from 'lucide-react'
import { fetchFridaySettings, type FridayCredentialState, type FridaySettings } from '../lib/api'
import SiteSettingsPanel from './SiteSettingsPanel'

const CREDENTIALS: Record<FridayCredentialState, string> = {
  present: 'Credentials present', missing: 'Credentials missing', 'not-required': 'No credentials needed',
}
const onOff = (value: boolean) => value ? 'Enabled' : 'Disabled'
const INTEGRITY: Record<string, string> = { verified: 'chain verified', broken: 'integrity check failed', unavailable: 'unavailable' }

function auditSummary(audit: FridaySettings['audit'] | undefined) {
  if (!audit?.enabled) return 'Disabled'
  return ['Enabled', INTEGRITY[audit.integrity || 'unavailable'], audit.events !== null ? `${audit.events} events` : null].filter(Boolean).join(' · ')
}

export default function SettingsWorkspace() {
  const [settings, setSettings] = useState<FridaySettings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchFridaySettings(controller.signal)
      .then(setSettings)
      .catch((reason) => { if (reason?.name !== 'AbortError') setError('Settings are unavailable. The settings API could not be reached or access was denied.') })
    return () => controller.abort()
  }, [])

  return <section className="v3-settings-workspace" aria-label="Settings workspace">
    <div className="v3-detail-hero">
      <div className="v3-node-icon large"><Settings/></div>
      <div><span className="v3-kicker">SERVER CONFIGURATION</span><h2>Settings</h2><p>Effective controller configuration. Only site labels can be edited here, by operators. Secrets, addresses and identities are never sent to the browser; change everything else in the server environment and redeploy.</p></div>
    </div>

    {error ? <p role="alert" className="v3-settings-message">{error}</p>
      : !settings ? <p role="status" className="v3-settings-message">Loading settings…</p>
        : <div className="v3-settings-grid">
          <section className="v3-panel v3-settings-wide" aria-label="Integrations">
            <div className="v3-section-head"><div><span className="v3-kicker">INTEGRATIONS</span><h2>{settings.integrations.filter((item) => item.enabled).length} of {settings.integrations.length} enabled</h2></div><span className="v3-settings-mode">{settings.mode} mode</span></div>
            <ul className="v3-settings-list">
              {settings.integrations.map((item) => <li key={item.id}>
                <span className="v3-settings-name"><b>{item.name}</b><small>{[item.site, item.checks !== undefined ? `${item.checks} checks` : null, item.tls === 'unverified' ? 'TLS not verified' : null].filter(Boolean).join(' · ')}</small></span>
                <span className={`v3-settings-pill ${item.enabled ? 'on' : 'off'}`}>{onOff(item.enabled)}</span>
                <span className={`v3-settings-pill ${item.configured ? 'on' : 'warn'}`}>{item.configured ? 'Configured' : 'Incomplete'}</span>
                <span className={`v3-settings-pill ${item.credentials === 'missing' ? 'warn' : 'off'}`}>{CREDENTIALS[item.credentials]}</span>
                {item.error && <code>{item.error}</code>}
              </li>)}
            </ul>
          </section>

          <SiteSettingsPanel/>

          <section className="v3-panel" aria-label="AI providers">
            <div className="v3-section-head"><div><span className="v3-kicker">ASSISTANT</span><h2>AI {settings.ai.enabled ? 'enabled' : 'disabled'}</h2></div></div>
            <ol className="v3-settings-order">{settings.ai.providerOrder.map((id, index) => <li key={id}>{index + 1}. {id}</li>)}</ol>
            <ul className="v3-settings-list compact">
              {settings.ai.providers.map((provider) => <li key={provider.id}>
                <span className="v3-settings-name"><b>{provider.id}</b><small>{provider.model || 'Default model'}{provider.enabled === false ? ' · local AI disabled' : ''}</small></span>
                <span className={`v3-settings-pill ${provider.inOrder ? 'on' : 'off'}`}>{provider.inOrder ? 'In failover order' : 'Not used'}</span>
                <span className={`v3-settings-pill ${provider.credentials === 'missing' && provider.inOrder ? 'warn' : 'off'}`}>{CREDENTIALS[provider.credentials]}</span>
              </li>)}
            </ul>
            <p className="v3-settings-message">Timeouts: cloud {settings.ai.cloudTimeoutMs ?? '—'} ms · local {settings.ai.localTimeoutMs ?? '—'} ms. Failover is sequential.</p>
          </section>

          <section className="v3-panel" aria-label="Access and safety">
            <div className="v3-section-head"><div><span className="v3-kicker">ACCESS</span><h2>Origin verification {settings.access.originVerification ? 'on' : 'off'}</h2></div><Lock size={16} aria-hidden="true"/></div>
            <dl className="v3-settings-facts">
              <dt>Cloudflare Access</dt><dd>{settings.access.configured ? 'Configured' : 'Not configured'}</dd>
              <dt>Operators</dt><dd>{settings.access.operators ? `${settings.access.operators} configured` : 'No operators configured (operator actions denied)'}</dd>
              <dt>Monitoring</dt><dd>{onOff(settings.monitoring.enabled)} · every {settings.monitoring.pollSeconds ?? '—'} s · grace {settings.monitoring.offlineGraceSeconds ?? '—'} s</dd>
              <dt>Diagnostics</dt><dd>{onOff(settings.monitoring.diagnostics)}</dd>
              <dt>Action audit</dt><dd>{auditSummary(settings.audit)}</dd>
              <dt>Notifications</dt><dd>{settings.notifications?.ntfy ? 'ntfy push on incident open and resolve' : 'Not configured'}</dd>
              <dt>Automation API</dt><dd>{onOff(settings.automationApi.enabled)} · port {settings.automationApi.port ?? '—'} · {settings.automationApi.serviceTokens} service tokens · read only</dd>
            </dl>
            <p className="v3-settings-safety"><ShieldCheck size={14} aria-hidden="true"/>Only site labels are writable here. No infrastructure actions or executor exist in this build.</p>
          </section>
        </div>}
  </section>
}
