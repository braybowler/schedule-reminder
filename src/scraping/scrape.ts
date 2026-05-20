import { config } from '../config/config';
import { logger } from '../logging/logger';
import { scrapeFirstAppointment } from './scraper';

function tomorrowInTz(tz: string): string {
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = todayParts.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + 1);
  return utc.toISOString().slice(0, 10);
}

function parseDateArg(arg: string | undefined, tz: string): string {
  if (!arg) return tomorrowInTz(tz);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    logger.error({ arg }, 'date arg must be YYYY-MM-DD');
    process.exit(1);
  }
  return arg;
}

async function main(): Promise<void> {
  const date = parseDateArg(process.argv[2], config.TIMEZONE);
  logger.info({ date, tz: config.TIMEZONE }, 'scraping for date');

  const result = await scrapeFirstAppointment(date);

  switch (result.kind) {
    case 'appointment':
      logger.info({ appointment: result.appointment }, 'first appointment');
      break;
    case 'empty':
      logger.info('no appointments');
      break;
    case 'error':
      logger.error({ reason: result.reason, artifacts: result.artifacts }, 'scrape failed');
      process.exitCode = 1;
      break;
  }
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'unhandled error');
  process.exit(1);
});
