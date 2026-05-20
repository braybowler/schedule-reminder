import { config } from './config/config';
import { logger } from './logging/logger';
import { type Appointment, scrapeFirstAppointmentWithRetry } from './scraping/scraper';
import { sendEmail, sendSms } from './notifications/notifier';

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

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function buildAppointmentMessage(date: string, appt: Appointment): string {
  return `${dateLabel(date)} — first appointment: ${appt.clientName} at ${appt.time}`;
}

function buildEmptyMessage(date: string): string {
  return `${dateLabel(date)} — no appointments scheduled`;
}

async function notifyHer(body: string): Promise<{ channel: 'sms' | 'email' | 'none'; error?: string }> {
  try {
    await sendSms(body);
    return { channel: 'sms' };
  } catch (err) {
    const smsError = err instanceof Error ? err.message : String(err);
    logger.warn({ smsError }, 'sms failed, attempting email fallback');
    if (!config.NOTIFY_EMAIL) {
      return { channel: 'none', error: `sms: ${smsError}; email: NOTIFY_EMAIL unset` };
    }
    try {
      await sendEmail({
        to: config.NOTIFY_EMAIL,
        subject: 'Tomorrow at the clinic',
        body,
      });
      return { channel: 'email' };
    } catch (emailErr) {
      const emailError = emailErr instanceof Error ? emailErr.message : String(emailErr);
      return { channel: 'none', error: `sms: ${smsError}; email: ${emailError}` };
    }
  }
}

async function alertBrayden(subject: string, body: string): Promise<void> {
  if (!config.ALERT_EMAIL) {
    logger.warn('ALERT_EMAIL unset — cannot send breakage alert');
    return;
  }
  try {
    await sendEmail({ to: config.ALERT_EMAIL, subject, body });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'alert email failed');
  }
}

export async function runOnce(dateArg?: string): Promise<void> {
  const date = dateArg ?? tomorrowInTz(config.TIMEZONE);
  logger.info({ date, tz: config.TIMEZONE }, 'schedule-reminder run');

  const result = await scrapeFirstAppointmentWithRetry(date);

  switch (result.kind) {
    case 'appointment': {
      const body = buildAppointmentMessage(date, result.appointment);
      logger.info({ body }, 'sending appointment notification');
      const delivery = await notifyHer(body);
      logger.info({ delivery }, 'run complete');
      if (delivery.channel === 'none') throw new Error(`notification failed: ${delivery.error}`);
      break;
    }
    case 'empty': {
      const body = buildEmptyMessage(date);
      logger.info({ body }, 'sending empty-day notification');
      const delivery = await notifyHer(body);
      logger.info({ delivery }, 'run complete');
      if (delivery.channel === 'none') throw new Error(`notification failed: ${delivery.error}`);
      break;
    }
    case 'error': {
      logger.error({ reason: result.reason, artifacts: result.artifacts }, 'scrape failed');
      const userBody = `${dateLabel(date)} — couldn't fetch schedule, check ClinicMaster manually`;
      await Promise.all([
        notifyHer(userBody).catch(() => undefined),
        alertBrayden(
          'schedule-reminder: scraper broken',
          `Scrape failed for ${date}.\n\nReason: ${result.reason}\n\nArtifacts: ${result.artifacts?.join('\n') ?? 'none'}`
        ),
      ]);
      throw new Error(`scrape failed: ${result.reason}`);
    }
  }
}

// CLI entry — only runs when invoked directly via `npm run run-once`.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  runOnce(process.argv[2]).catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'run failed');
    process.exit(1);
  });
}
