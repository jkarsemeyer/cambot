// Named events. Gestures and effects announce things ("lightning_strike"); anything can listen.

const handlers = {};
let logger = null;

export const bus = {
  on(name, fn) {
    (handlers[name] ||= []).push(fn);
    return () => { handlers[name] = (handlers[name] || []).filter(f => f !== fn); };
  },
  emit(name, data) {
    if (logger) logger(name, data);
    for (const fn of (handlers[name] || []).slice()) {
      try { fn(data); } catch (e) { console.error(`Listener for ${name} failed`, e); }
    }
  },
  setLogger(fn) { logger = fn; },
};
