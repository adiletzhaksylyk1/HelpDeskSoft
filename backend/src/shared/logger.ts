import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: ['password', 'secret', 'IMAP_PASSWORD', 'SMTP_PASSWORD', 'authorization'],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
