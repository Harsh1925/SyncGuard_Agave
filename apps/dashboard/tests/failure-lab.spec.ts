import { test, expect } from '@playwright/test';
test('Failure Lab accepts safe invoices, detects drift and executes a crash run', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'System health', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Operation timeline / Failure lab' }).click();
  await expect(page.getByText('Isolated demo controls enabled.')).toBeVisible();
  await page.getByLabel('Seed', { exact: true }).fill('-1');
  await page.getByRole('button', { name: 'Run seeded chaos' }).click();
  await expect(page.getByText('Enter a seed from 0 to 4294967295.')).toBeVisible();
  await expect(page.getByLabel('Seed', { exact: true })).toBeFocused();
  await page.getByLabel('Seed', { exact: true }).fill('42');
  const invoice = {
    company_id: 'ACME',
    vendor_id: 'V001',
    invoice_number: `UI-${Date.now()}`,
    job_id: 'J001',
    amount: '15.00',
    currency: 'USD',
    issued_on: '2026-01-15',
    status: 'open',
  };
  await page
    .getByLabel('Synthetic invoice document')
    .fill(JSON.stringify({ ...invoice, vendor_id: 'UNKNOWN' }));
  await page.getByRole('button', { name: 'Validate and accept invoice' }).click();
  await expect(page.getByText('unknown_vendor', { exact: true })).toBeVisible();
  await page.getByLabel('Synthetic invoice document').fill(JSON.stringify(invoice));
  await page.getByRole('button', { name: 'Start new proposal' }).click();
  await page.getByRole('button', { name: 'Validate and accept invoice' }).click();
  await expect(
    page.getByText('Invoice accepted by ERP. Run a snapshot to propagate it.'),
  ).toBeVisible();
  async function sync() {
    await page.getByRole('button', { name: 'Run snapshot', exact: true }).click();
    await expect(
      page.getByText('Complete snapshot recorded; queued work is ready for the worker.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Process next queued job' }).click();
    await expect(
      page.getByText(
        'Worker step completed. Refresh the operation timeline to inspect the result.',
      ),
    ).toBeVisible();
  }
  await sync();
  await page.getByRole('link', { name: 'System health', exact: true }).click();
  await page.locator('table a').first().click();
  await expect(page.getByText(invoice.invoice_number, { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Inject drift', exact: true }).click();
  await expect(page.getByText('Drift injected and reconciliation completed.')).toBeVisible();
  expect(
    (
      await page.request.put('http://localhost:8101/invoices', {
        data: { ...invoice, amount: '16.00' },
      })
    ).status(),
  ).toBe(200);
  await sync();
  await page.getByRole('button', { name: 'Run reconciliation', exact: true }).click();
  await expect(page.getByText('Reconciliation completed.', { exact: true })).toBeVisible();
  await page
    .getByLabel('Critical crash boundary')
    .selectOption('AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION');
  await page.getByLabel('Steps', { exact: true }).fill('1');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/chaos/runs') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Run seeded chaos' }).click();
  const { id } = await (await response).json();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`http://localhost:8100/chaos/runs/${id}`)).json()).status,
      { timeout: 60000 },
    )
    .toBe('completed');
  await page.getByRole('button', { name: 'Refresh lab' }).click();
  await expect(page.getByText(`Seed 42 · completed · ${id}`, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
