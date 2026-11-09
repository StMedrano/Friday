import { ExternalLink, Plug } from 'lucide-react'

const INTEGRATIONS_DOC = 'https://github.com/StMedrano/Friday/blob/main/docs/integrations.md'

/** Sections of docs/integrations.md that explain how to connect a placeholder. */
export const SETUP_SECTIONS = [
  'Uptime history',
  'Self-hosted Supabase runtime registry',
  'Agent activity log',
  'Approvals queue',
  'New tasks (Tasks write path)',
  'GitHub pull requests, CI and last commit',
] as const
export type SetupSection = typeof SETUP_SECTIONS[number]

/** Link to a heading of the repository's integrations doc, using GitHub's anchor rules. */
export function setupDocUrl(section: SetupSection) {
  const anchor = section.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')
  return `${INTEGRATIONS_DOC}#${anchor}`
}

/**
 * A designed control for a capability the Friday backend does not provide yet.
 * It is always inert and says so in text, so the layout can match the design
 * without implying that anything ran or that the numbers are real. `setup`
 * names the docs/integrations.md section that explains how to connect it.
 */
export default function NotConnected({ title, detail, action, setup }: { title: string; detail?: string; action?: string; setup?: SetupSection }) {
  return <div className="fx-not-connected" role="note" aria-label={`${title}: not connected`}>
    <span className="fx-not-connected-icon" aria-hidden="true"><Plug size={15}/></span>
    <span className="fx-not-connected-body"><b>{title}</b>{detail && <small>{detail}</small>}
      {setup && <a className="fx-not-connected-setup" href={setupDocUrl(setup)} target="_blank" rel="noreferrer" aria-label={`How to connect: ${setup}`}>How to connect<ExternalLink size={11} aria-hidden="true"/></a>}
    </span>
    {action ? <button type="button" disabled title="Not connected">{action}</button> : <em>Not connected</em>}
  </div>
}
