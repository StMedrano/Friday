import { useEffect, useState } from 'react'
import { ExternalLink, Lock, Settings, ShieldCheck } from 'lucide-react'
import { fetchFridaySettings, type FridayCredentialState, type FridaySettings, type FridaySettingsFeature } from '../lib/api'
import { isSetupSection, setupDocUrl } from './NotConnected'
import SiteSettingsPanel from './SiteSettingsPanel'
import EndpointChecksPanel from './EndpointChecksPanel'
import RepositorySettingsPanel from './RepositorySettingsPanel'
import PushControls from './PushControls'
import WorkIdentityPanel from './WorkIdentityPanel'
import AuditWorkspace from './AuditWorkspace'
import AiDesignerSessionsPanel from './AiDesignerSessionsPanel'

const TABS = ['General', 'Notifications', 'Sites', 'Access & roles', 'Audit log'] as const
type Tab = typeof TABS[number]

const CREDENTIALS: Record<FridayCredentialState, string> = {
  present: 'Credentials present', missing: 'Credentials missing', 'not-required': 'No credentials needed',
}
const onOff = (value: boolean) => value ? 'Enabled' : 'Disabled'
const INTEGRITY: Record<string, string> = { verified: 'chain verified', broken: 'integrity check failed', unavailable: 'unavailable' }

function auditSummary(audit: FridaySettings['audit'] | undefined) {
  if (!audit?.enabled) return 'Disabled'
  return ['Enabled', INTEGRITY[audit.integrity || 'unavailable'], audit.events !== null ? `${audit.events} events` : null].filter(Boolean).join(' · ')
}

function serviceTokenText(token: NonNullable<FridaySettings['serviceToken']>) {
  if (token.state === 'expired') return `Expired on ${token.expiresAt}. Renew it now.`
  const when = token.daysRemaining === 0 ? 'Expires today' : `Expires in ${token.daysRemaining} day${token.daysRemaining === 1 ? '' : 's'}`
  return `${when} (${token.expiresAt})${token.state === 'warning' ? '. Renew it soon.' : ''}`
}

function ServiceTokenExpiry({ token }: { token: NonNullable<FridaySettings['serviceToken']> }) {
  const tone = token.state === 'expired' ? 'error' : token.state === 'warning' ? 'warn' : 'off'
  return <span data-testid="service-token-expiry" className={`v3-settings-pill ${tone}`} role={token.state === 'ok' ? undefined : 'status'}>{serviceTokenText(token)}</span>
}

function FeaturesPanel({ features, hidden }: { features: FridaySettingsFeature[]; hidden: boolean }) {
  return <section className="v3-panel v3-settings-wide" aria-label="Features" hidden={hidden}>
    <div className="v3-section-head"><div><span className="v3-kicker">OPT-IN FEATURES</span><h2>{features.filter((item) => item.enabled).length} of {features.length} on</h2></div></div>
    <ul className="v3-settings-list">
      {features.map((item) => <li key={item.id}>
        <span className="v3-settings-name"><b>{item.name}</b>
          {isSetupSection(item.setup) && <small><a href={setupDocUrl(item.setup)} target="_blank" rel="noreferrer" aria-label={`How to turn on: ${item.setup}`}>How to turn on<ExternalLink size={11} aria-hidden="true"/></a></small>}
        </span>
        <span className={`v3-settings-pill ${item.enabled ? 'on' : 'off'}`}>{item.enabled ? 'On' : 'Off'}</span>
        {item.enabled && !item.configured && <span className="v3-settings-pill warn" title="The flag is on but a setting it needs is missing">Incomplete</span>}
      </li>)}
    </ul>
  </section>
}

export default function SettingsWorkspace() {
  const [settings, setSettings] = useState<FridaySettings | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('General')

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
      <div><span className="v3-kicker">SERVER CONFIGURATION</span><h2>Settings</h2><p>Effective controller configuration. Operators can edit site labels, endpoint checks and repositories here. Secrets, addresses and identities are never sent to the browser; change everything else in the server environment and redeploy.</p></div>
    </div>

    <div className="fx-tabs" role="tablist" aria-label="Settings sections">
      {TABS.map((name) => <button key={name} type="button" role="tab" id={`settings-tab-${name}`} aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}
    </div>

    {tab === 'Audit log' ? <div role="tabpanel" aria-labelledby="settings-tab-Audit log"><AuditWorkspace/></div>
      : error ? <p role="alert" className="v3-settings-message">{error}</p>
      : !settings ? <p role="status" className="v3-settings-message">Loading settings…</p>
        : <div className="v3-settings-grid">
          <section className="v3-panel v3-settings-wide" aria-label="Integrations" hidden={tab !== 'General'}>
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

          {settings.features?.length ? <FeaturesPanel features={settings.features} hidden={tab !== 'General'}/> : null}

          <AiDesignerSessionsPanel enabled={settings.integrations.some((item) => item.id === 'aidesigner' && item.enabled)} hidden={tab !== 'General'}/>

          <div className="fx-tab-group" hidden={tab !== 'Sites'}>
            <SiteSettingsPanel/>
            <EndpointChecksPanel/>
            <RepositorySettingsPanel/>
          </div>

          <section className="v3-panel" aria-label="AI providers" hidden={tab !== 'General'}>
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

          <section className="v3-panel" aria-label="Notifications" hidden={tab !== 'Notifications'}>
            <div className="v3-section-head"><div><span className="v3-kicker">NOTIFICATIONS</span><h2>Alerts</h2></div></div>
            <dl className="v3-settings-facts">
              <dt>ntfy</dt><dd>{onOff(Boolean(settings.notifications?.ntfy))}</dd>
              <dt>Browser push</dt><dd>{onOff(Boolean(settings.notifications?.webPush))}</dd>
            </dl>
            <PushControls/>
          </section>

          <section className="v3-panel" aria-label="Access and safety" hidden={tab !== 'Access & roles'}>
            <div className="v3-section-head"><div><span className="v3-kicker">ACCESS</span><h2>Origin verification {settings.access.originVerification ? 'on' : 'off'}</h2></div><Lock size={16} aria-hidden="true"/></div>
            <dl className="v3-settings-facts">
              <dt>Cloudflare Access</dt><dd>{settings.access.configured ? 'Configured' : 'Not configured'}</dd>
              {settings.serviceToken && <><dt>Service token</dt><dd><ServiceTokenExpiry token={settings.serviceToken}/></dd></>}
              <dt>Operators</dt><dd>{settings.access.operators ? `${settings.access.operators} configured` : 'No operators configured (operator actions denied)'}</dd>
              <dt>Monitoring</dt><dd>{onOff(settings.monitoring.enabled)} · every {settings.monitoring.pollSeconds ?? '—'} s · grace {settings.monitoring.offlineGraceSeconds ?? '—'} s</dd>
              <dt>Diagnostics</dt><dd>{onOff(settings.monitoring.diagnostics)}</dd>
              <dt>Action audit</dt><dd>{auditSummary(settings.audit)}</dd>
              <dt>Notifications</dt><dd>{[settings.notifications?.ntfy ? 'ntfy' : null, settings.notifications?.webPush ? 'browser push' : null].filter(Boolean).join(' · ') || 'Not configured'}</dd>
              <dt>Automation API</dt><dd>{onOff(settings.automationApi.enabled)} · port {settings.automationApi.port ?? '—'} · {settings.automationApi.serviceTokens} service tokens · read only</dd>
            </dl>
            <WorkIdentityPanel/>
            <p className="v3-settings-safety"><ShieldCheck size={14} aria-hidden="true"/>Only site labels, endpoint checks and repositories are writable here. No infrastructure actions or executor exist in this build.</p>
          </section>
        </div>}
  </section>
}
