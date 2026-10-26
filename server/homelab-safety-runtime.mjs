import {isAbsolute,resolve,dirname} from 'node:path'
import {createHomeLabAudit} from './homelab-audit.mjs'
import {createHomeLabControl} from './homelab-control.mjs'
import {createFileOperatorRolePolicy} from './security/file-operator-policy.mjs'
import {createFileAutomationGate} from './security/automation-kill-switch.mjs'

const denied=()=>{throw Error('homelab-denied')}
const absolute=value=>typeof value==='string'&&isAbsolute(value)&&resolve(value)===value

/**
 * Dormant, opt-in composition of Friday's internal P8 safety foundations.
 * NOT invoked by server/index.mjs, mounted on HTTP, or granted to any AI.
 *
 * This factory creates no executor, credentials, service binding or real
 * infrastructure target. All requests still use signed Cloudflare Access JWTs,
 * the exact symbolic "staging-canary", immutable private audit events, a
 * short-lived owner-private role policy and a separately revocable kill file.
 *
 * Do not enable this in production. Production approval/execution needs a
 * separate security review and an independently authorized action boundary.
 */
export async function createDormantHomeLabRuntime({
 enabled=false,
 access,
 auditDirectory,
 policyFilePath,
 gateFilePath,
 diagnostics,
 config,
 assistant,
 fetchKeys,
 now=Date.now,
 diagnosticTimeoutMs,
}={}) {
 // Safe default: no paths, network requests, database writes or audit dir.
 if(enabled!==true)return createHomeLabControl()
 if(!absolute(auditDirectory)||!absolute(policyFilePath)||!absolute(gateFilePath)||
    typeof now!=='function'||policyFilePath===gateFilePath||
    auditDirectory===dirname(policyFilePath)||auditDirectory===dirname(gateFilePath)||
    auditDirectory===policyFilePath||auditDirectory===gateFilePath)denied()

 const gate=createFileAutomationGate({filePath:gateFilePath,now})
 const rolePolicy=createFileOperatorRolePolicy({filePath:policyFilePath,now})
 const store=await createHomeLabAudit({directory:auditDirectory})
 return createHomeLabControl({
  enabled:true,access,store,rolePolicy,automationAllowed:gate.isAllowed,
  diagnostics,config,assistant,fetchKeys,now,diagnosticTimeoutMs,
 })
}
