import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const ConfigSchema = z.object({
  CLINICMASTER_LOGIN_URL: z.string().url(),
  CLINICMASTER_CALENDAR_URL: z.string().url(),
  CLINICMASTER_USERNAME: z.string().min(1),
  CLINICMASTER_PASSWORD: z.string().min(1),
  HEADLESS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error'])
    .default('info'),
  TIMEZONE: z.string().default('America/Toronto'),

  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_FROM_NUMBER: optionalString,
  NOTIFY_PHONE_NUMBER: optionalString,

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  NOTIFY_EMAIL: optionalString,
  ALERT_EMAIL: optionalString,

  SCHEDULE_CRON: z.string().default('55 20 * * 0-4'),
});

const parsed = ConfigSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
