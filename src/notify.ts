import { config } from './config';
import { logger } from './logger';
import { sendEmail, sendSms } from './notifier';

async function tryChannel<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ channel: name, error }, `${name} failed`);
    return { ok: false, error };
  }
}

async function main(): Promise<void> {
  const body = process.argv[2] ?? 'test message from schedule-reminder';
  logger.info({ body }, 'sending test notification');

  const sms = await tryChannel('sms', () => sendSms(body));

  const emailTo = config.NOTIFY_EMAIL ?? config.ALERT_EMAIL;
  const email = emailTo
    ? await tryChannel('email', () =>
        sendEmail({ to: emailTo, subject: 'schedule-reminder test', body })
      )
    : ({ ok: false, error: 'NOTIFY_EMAIL and ALERT_EMAIL both unset' } as const);

  logger.info({ sms, email }, 'done');
  if (!sms.ok && !email.ok) process.exit(1);
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'unhandled error');
  process.exit(1);
});
