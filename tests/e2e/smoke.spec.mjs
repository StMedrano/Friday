import { expect, test } from '@playwright/test'

// Read-only smoke test against the mock server: no credentials, no writes.

test('desktop dashboard loads the overview and reaches Settings', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Workspaces' })
  await expect(nav).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('status', { name: 'Automation execution status' })).toContainText('Read only')

  await nav.getByRole('button', { name: 'Settings' }).click()
  await expect(nav.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Settings')
})

test('phone navigation sheet opens, traps focus and closes on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const bar = page.getByRole('navigation', { name: 'Mobile command bar' })
  await expect(bar).toBeVisible()

  const more = bar.getByRole('button', { name: 'More' })
  await more.click()
  const sheet = page.getByRole('dialog', { name: 'More FRIDAY views' })
  await expect(sheet).toBeVisible()

  // Tab through more stops than the sheet has; focus must stay inside it.
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab')
    expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(more).toBeFocused()

  await more.click()
  await page.getByRole('dialog', { name: 'More FRIDAY views' }).getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'More FRIDAY views' })).toBeHidden()
  await expect(bar.getByRole('button', { name: 'More' })).toHaveClass(/active/)
})

// Read-only: these open each screen and check what it shows. They never press
// New task, Approve or Deny, and the mock server keeps every write flag off.
test('Tasks screen renders its read-only state with no way to add a task', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Workspaces' })
  await nav.getByRole('button', { name: 'Tasks' }).click()
  await expect(nav.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')

  const tasks = page.getByRole('region', { name: 'Project tasks workspace' })
  await expect(tasks).toBeVisible()
  await expect(tasks.getByRole('status').filter({ hasText: 'Project tasks are not enabled on this controller.' })).toBeVisible()
  await expect(tasks.getByRole('note', { name: 'New tasks: not connected' })).toBeVisible()
  await expect(tasks.getByRole('button', { name: 'Add task' })).toHaveCount(0)
})

test('Approvals queue renders its not connected state with no decision buttons', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Workspaces' })
  await nav.getByRole('button', { name: 'Approvals' }).click()
  await expect(nav.getByRole('button', { name: 'Approvals' })).toHaveAttribute('aria-current', 'page')

  const approvals = page.getByRole('region', { name: 'Approvals workspace' })
  await expect(approvals).toBeVisible()
  await expect(approvals.getByRole('note', { name: 'Approvals: not connected' })).toBeVisible()
  await expect(approvals.getByRole('button', { name: /^(Approve|Deny)\b/ })).toHaveCount(0)
})
