import { describe, expect, it } from 'vitest'
import mobileCss from './mobile.css?inline'
import diagnosticsPolishCss from './diagnostics-polish.css?inline'

describe('FRIDAY mobile CSS contract', () => {
  it('contains the phone breakpoint and safe-area command bar protections', () => {
    expect(mobileCss).toContain('@media(max-width:700px)')
    expect(mobileCss).toContain('env(safe-area-inset-bottom)')
    expect(mobileCss).toContain('max-width:100%')
    expect(mobileCss).toContain('overflow-x:hidden')
  })

  it('provides reduced motion handling for decorative phone animation', () => {
    expect(mobileCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(mobileCss).toMatch(/animation\s*:\s*none/)
  })

  it('styles touch targets and the actual mobile command bar class', () => {
    expect(mobileCss).toContain('.v3-mobile-command-bar')
    expect(mobileCss).toMatch(/min-height\s*:\s*44px/)
    expect(mobileCss).toContain('.v3-mobile-more-sheet')
    expect(mobileCss).toContain('.v3-diagnostic-logs')
  })

  it('keeps diagnostic log lines unwrapped and confines horizontal scrolling to the log panel', () => {
    const rule = diagnosticsPolishCss.match(/\.v3-phone-shell \.v3-diagnostic-logs\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/white-space\s*:\s*pre(?:;|$)/)
    expect(rule).toMatch(/overflow-x\s*:\s*auto/)
    expect(rule).not.toMatch(/pre-wrap/)
  })
})
