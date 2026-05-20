import twilio from 'twilio';
import nodemailer from 'nodemailer';
import { config } from '../config/config';
import { logger } from '../logging/logger';

export async function sendSms(body: string): Promise<void> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, NOTIFY_PHONE_NUMBER } = config;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !NOTIFY_PHONE_NUMBER) {
    throw new Error(
      'Twilio not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, NOTIFY_PHONE_NUMBER'
    );
  }
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const msg = await client.messages.create({
    body,
    from: TWILIO_FROM_NUMBER,
    to: NOTIFY_PHONE_NUMBER,
  });
  logger.info({ sid: msg.sid, to: NOTIFY_PHONE_NUMBER }, 'sms sent');
}

export type EmailOptions = {
  to: string;
  subject: string;
  body: string;
};

export async function sendEmail({ to, subject, body }: EmailOptions): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = config;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS');
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const info = await transporter.sendMail({
    from: SMTP_USER,
    to,
    subject,
    text: body,
  });
  logger.info({ messageId: info.messageId, to }, 'email sent');
}
