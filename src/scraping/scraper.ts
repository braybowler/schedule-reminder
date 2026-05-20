import { chromium, type Browser, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/config';
import { logger } from '../logging/logger';

export type Appointment = {
  clientName: string;
  time: string;
};

export type ScrapeResult =
  | { kind: 'appointment'; appointment: Appointment }
  | { kind: 'empty' }
  | { kind: 'error'; reason: string; artifacts?: string[] };

const SELECTORS = {
  login: {
    username: 'dx-text-box[formcontrolname="login"] input',
    password: 'dx-text-box[formcontrolname="password"] input',
    submit: 'dx-button[aria-label="Login"]',
  },
  calendar: {
    navButton: 'app-navigation a.menu-item:has(span:text-is("Calendar"))',
    dateDisplay: '#calendarDateBoxDD span',
    prevArrow: 'app-control-center-toolbar a:has(i.icon-left-arrow)',
    nextArrow: 'app-control-center-toolbar a:has(i.icon-right-arrow)',
    appointment: '.dx-scheduler-appointment',
    // Wait target: the inner grid host. The outer <dx-scheduler> element
    // does not render reliably in headless Chromium, but .dx-scheduler-work-space
    // is consistently present once the grid has mounted.
    grid: '.dx-scheduler-work-space',
  },
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseLabel(label: string): string | null {
  const m = label.match(/^(\w+)\s+(\d+),\s+(\d+)/);
  if (!m) return null;
  const month = MONTH_ABBR.indexOf(m[1]) + 1;
  if (month === 0) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function formatTime(iso: string): string {
  const hms = iso.split('T')[1] ?? '';
  const [hStr, m] = hms.split(':');
  const h = Number(hStr);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m} ${period}`;
}

function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const monthDay = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
  }).format(date);
  return `${monthDay} ${weekday}`;
}

const ARTIFACTS_DIR = 'artifacts';

async function saveArtifacts(page: Page, label: string): Promise<string[]> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const pngPath = join(ARTIFACTS_DIR, `${label}-${ts}.png`);
  const htmlPath = join(ARTIFACTS_DIR, `${label}-${ts}.html`);
  await page.screenshot({ path: pngPath, fullPage: true });
  await writeFile(htmlPath, await page.content());
  return [pngPath, htmlPath];
}

// Per-selector / per-step timeout. The droplet under chromium load is meaningfully
// slower than a dev laptop, and this job runs once a night, so we trade latency
// for reliability.
const STEP_TIMEOUT_MS = 60_000;

async function login(page: Page): Promise<void> {
  logger.info({ url: config.CLINICMASTER_LOGIN_URL }, 'opening login page');
  await page.goto(config.CLINICMASTER_LOGIN_URL, { waitUntil: 'domcontentloaded' });

  logger.info('filling login form');
  await page.locator(SELECTORS.login.username).first().fill(config.CLINICMASTER_USERNAME);
  await page.locator(SELECTORS.login.password).first().fill(config.CLINICMASTER_PASSWORD);

  logger.info('submitting');
  await page.locator(SELECTORS.login.submit).first().click();

  logger.info('waiting for dashboard');
  await page.waitForURL(/\/main\/dashboard/, { timeout: STEP_TIMEOUT_MS });
  logger.info('logged in');
}

async function navigateToCalendar(page: Page): Promise<void> {
  logger.info('clicking Calendar nav button from dashboard');
  await page.locator(SELECTORS.calendar.navButton).first().click();
  await page.waitForURL(/control-center/, { timeout: STEP_TIMEOUT_MS });
  await page.locator(SELECTORS.calendar.grid).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
  logger.info({ url: page.url() }, 'calendar loaded');
}

async function setCalendarDate(page: Page, date: string): Promise<void> {
  const target = formatDateLabel(date);
  const dateDisplay = page.locator(SELECTORS.calendar.dateDisplay).first();
  const prevArrow = page.locator(SELECTORS.calendar.prevArrow).first();
  const nextArrow = page.locator(SELECTORS.calendar.nextArrow).first();

  const start = (await dateDisplay.textContent())?.trim() ?? '';
  logger.info({ from: start, to: target }, 'setting calendar date');

  for (let i = 0; i < 60; i++) {
    const current = (await dateDisplay.textContent())?.trim();
    if (current === target) {
      logger.info({ date: target, clicks: i }, 'date set');
      // Give the grid a beat to re-render appointment cells after the date change.
      await page.waitForTimeout(3_000);
      return;
    }
    const currentIso = parseLabel(current ?? '');
    const arrow = currentIso && currentIso > date ? prevArrow : nextArrow;
    await arrow.dispatchEvent('click');
    await page.waitForFunction(
      ({ sel, expected }) => {
        const el = document.querySelector(sel);
        return el && el.textContent?.trim() !== expected;
      },
      { sel: SELECTORS.calendar.dateDisplay, expected: current ?? '' },
      { timeout: STEP_TIMEOUT_MS }
    );
  }
  throw new Error(`failed to advance calendar to ${target}`);
}

async function extractFirstNonCancellation(page: Page): Promise<Appointment | null> {
  const candidates = await page.locator(SELECTORS.calendar.appointment).evaluateAll((els) =>
    els.map((el) => {
      const cell = el.querySelector('.cell-container');
      const eventCell = el.querySelector('.event-cell');
      const clientName =
        el.querySelector('.client_name b')?.textContent?.trim() ?? null;
      const appDateTime = cell?.getAttribute('data-appdatetime') ?? null;
      const cellId = cell?.id ?? '';
      const eventCellClasses = eventCell?.className ?? '';
      const statusClasses = Array.from(el.querySelectorAll('.status-point'))
        .map((s) => (s as HTMLElement).className)
        .join(' ');
      const isCancelled =
        /cancel/i.test(eventCellClasses) || /cancel/i.test(statusClasses);
      return { clientName, appDateTime, cellId, isCancelled };
    })
  );

  const valid = candidates
    .filter(
      (a) =>
        a.cellId.startsWith('app-') &&
        a.clientName &&
        a.appDateTime &&
        !a.isCancelled
    )
    .sort((a, b) => (a.appDateTime ?? '').localeCompare(b.appDateTime ?? ''));

  logger.info(
    { total: candidates.length, valid: valid.length },
    'extracted appointment candidates'
  );

  if (valid.length === 0) return null;

  const first = valid[0];
  return {
    clientName: first.clientName!,
    time: formatTime(first.appDateTime!),
  };
}

export async function scrapeFirstAppointmentWithRetry(
  date: string,
  maxAttempts = 2
): Promise<ScrapeResult> {
  let last: ScrapeResult = { kind: 'error', reason: 'no attempts made' };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await scrapeFirstAppointment(date);
    if (last.kind !== 'error') return last;
    if (attempt < maxAttempts) {
      logger.warn({ attempt, reason: last.reason }, 'scrape failed, retrying in 5s');
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  return last;
}

// Hard ceiling on a single scrape attempt. If exceeded, the browser is force-closed,
// which causes any in-flight Playwright operation to reject and surface as a scrape error.
const OVERALL_TIMEOUT_MS = 5 * 60_000;

export async function scrapeFirstAppointment(date: string): Promise<ScrapeResult> {
  const browser: Browser = await chromium.launch({ headless: config.HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);

  const overallTimer = setTimeout(() => {
    logger.warn({ timeoutMs: OVERALL_TIMEOUT_MS }, 'scrape exceeded overall timeout, force-closing browser');
    void browser.close().catch(() => undefined);
  }, OVERALL_TIMEOUT_MS);

  try {
    await login(page);
    await navigateToCalendar(page);
    await setCalendarDate(page, date);

    const artifacts = await saveArtifacts(page, 'calendar');
    logger.debug({ artifacts }, 'saved calendar artifacts');

    const appointment = await extractFirstNonCancellation(page);

    if (appointment) {
      return { kind: 'appointment', appointment };
    }
    return { kind: 'empty' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const artifacts = await saveArtifacts(page, 'error').catch(() => []);
    logger.error({ reason, artifacts }, 'scrape failed');
    return { kind: 'error', reason, artifacts };
  } finally {
    clearTimeout(overallTimer);
    await browser.close().catch(() => undefined);
  }
}
