import { webConfig } from './config.js';

const LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function getActiveLevel() {
  const configured = String(webConfig.logLevel ?? 'info').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LEVEL_ORDER, configured)) {
    return configured;
  }
  return 'info';
}

function shouldLog(level) {
  const target = LEVEL_ORDER[level] ?? LEVEL_ORDER.info;
  const active = LEVEL_ORDER[getActiveLevel()] ?? LEVEL_ORDER.info;
  return target >= active;
}

function log(level, message, context = null) {
  if (!shouldLog(level)) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(context && typeof context === 'object' ? { context } : {})
  };
  if (level === 'error') {
    console.error('[BrianHub]', payload);
    return;
  }
  if (level === 'warn') {
    console.warn('[BrianHub]', payload);
    return;
  }
  if (level === 'debug') {
    console.debug('[BrianHub]', payload);
    return;
  }
  console.info('[BrianHub]', payload);
}

export const logger = {
  debug(message, context) {
    log('debug', message, context);
  },
  info(message, context) {
    log('info', message, context);
  },
  warn(message, context) {
    log('warn', message, context);
  },
  error(message, context) {
    log('error', message, context);
  }
};

