import cron from 'node-cron';
import { config } from '../config/config';
import { logger } from '../logging/logger';
import { runOnce } from '../run';

function start(): void {
  const { SCHEDULE_CRON, TIMEZONE } = config;

  if (!cron.validate(SCHEDULE_CRON)) {
    logger.error({ SCHEDULE_CRON }, 'invalid cron expression');
    process.exit(1);
  }

  cron.schedule(
    SCHEDULE_CRON,
    () => {
      logger.info('scheduled fire — starting run');
      runOnce().catch((err) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'scheduled run failed'
        );
      });
    },
    { timezone: TIMEZONE }
  );

  logger.info({ cron: SCHEDULE_CRON, tz: TIMEZONE }, 'scheduler started');

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, exiting');
    process.exit(0);
  });
  process.on('SIGINT', () => {
    logger.info('SIGINT received, exiting');
    process.exit(0);
  });
}

start();
