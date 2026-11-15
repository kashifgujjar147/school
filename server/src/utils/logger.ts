import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'password', '*.password', '*.passwordHash', '*.token', 'MONGODB_URI'],
    censor: '[redacted]'
  },
  base: { app: 'sms', node: process.env.NODE_ID }
});
