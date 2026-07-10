import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

const login = async (page, email) => {
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', 'wfg2026');
  await page.click('button[type=submit]');
  await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 15000 });
};

const run = async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'csst@wfg.demo');

  // 1. Create a unit with its login
  await admin.goto(`${BASE}/admin?tab=units`);
  await admin.fill('#new-unit-name', 'Workforce Digital');
  await admin.fill('#new-unit-slug', 'digital');
  await admin.getByRole('button', { name: 'Create unit and login' }).click();
  await admin.getByText('digital@wfg.demo').waitFor({ timeout: 15000 });
  console.log('create unit OK');

  // 2. Add a unit objective for it
  await admin.goto(`${BASE}/admin?tab=objectives`);
  const digitalCard = admin.locator('div.bg-card', { hasText: 'Workforce Digital' }).last();
  await digitalCard.locator('input[name=title]').last().fill('Launch HR analytics products');
  await digitalCard.getByRole('button', { name: 'Add' }).last().click();
  await admin.waitForLoadState('networkidle');
  console.log('create objective OK');

  // 3. Add a KPI under it
  await admin.goto(`${BASE}/admin?tab=kpis`);
  await admin.selectOption('#kpi-unit', { label: 'Workforce Digital' });
  await admin.getByRole('button', { name: 'Open', exact: true }).click();
  await admin.waitForLoadState('networkidle');
  await admin.fill('#new-kpi-name', 'Digital product revenue');
  await admin.selectOption('#new-kpi-obj', { label: 'Launch HR analytics products' });
  await admin.selectOption('#new-kpi-persp', { label: 'Financial' });
  await admin.fill('#new-kpi-uom', 'NGN m');
  await admin.getByRole('button', { name: 'Add KPI' }).click();
  await admin
    .locator('input[value="Digital product revenue"]')
    .first()
    .waitFor({ timeout: 15000 });
  console.log('create KPI OK');

  // 4. Set its annual target with seasonal phasing
  await admin.goto(`${BASE}/targets`);
  await admin.selectOption('select[name=unit]', { label: 'Workforce Digital' });
  await admin.getByRole('button', { name: 'Open', exact: true }).click();
  await admin.waitForLoadState('networkidle');
  const annual = admin.locator('input[name=value]').first();
  await annual.fill('40');
  await admin.selectOption('select[name=phasing]', 'seasonal');
  await admin.getByRole('button', { name: 'Save annual target' }).first().click();
  await admin.waitForLoadState('networkidle');
  await admin.goto(admin.url());
  const jan = await admin.locator('input[name=m1]').first().inputValue();
  if (jan !== '2.4') throw new Error(`expected seasonal Jan target 2.4, got ${jan}`);
  console.log('seasonal target phasing OK');

  // 5. Log in as the new unit's operator and enter an actual
  const op = await (await browser.newContext()).newPage();
  await login(op, 'digital@wfg.demo');
  await op.waitForURL('**/report**');
  await op.getByLabel(/Digital product revenue actual/).fill('3.1');
  await op.getByRole('button', { name: /Save .* actuals/ }).click();
  await op.getByText(/Saved at/).waitFor({ timeout: 15000 });
  console.log('new operator entry OK');

  // 6. Audit log shows the trail
  await admin.goto(`${BASE}/admin/audit`);
  await admin.getByText('unit.create').first().waitFor();
  await admin.getByText('kpi.create').first().waitFor();
  await admin.getByText('target.annual').first().waitFor();
  console.log('audit trail OK');

  await browser.close();
  console.log('E2E ADMIN FLOW PASSED');
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
