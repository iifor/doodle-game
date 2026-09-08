const schema = {
  map: { initial: 'district', valid: (v) => v === 'district' },
  best: { initial: 0, valid: (v) => Number.isSafeInteger(v) && v >= 0 },
  checkpoint: { initial: 0, valid: (v) => Number.isSafeInteger(v) && v >= 0 && v <= 10000 && v % 5 === 0 },
  sensitivity: { initial: 100, valid: (v) => Number.isFinite(v) && v >= 25 && v <= 250 },
  touchSensitivity: { initial: 100, valid: (v) => Number.isFinite(v) && v >= 25 && v <= 250 },
  quality: { initial: 'standard', valid: (v) => ['smooth', 'standard'].includes(v) },
  invert: { initial: false, valid: (v) => typeof v === 'boolean' },
  music: { initial: true, valid: (v) => typeof v === 'boolean' },
};

export const STORAGE_PREFIX = 'doodle-game:shooter:v1:';

export function createPreferences(storage, { touch = false } = {}) {
  const values = {};
  function validate(key, value) {
    if (!Object.hasOwn(schema, key)) throw new Error(`Unknown preference: ${key}`);
    if (!schema[key].valid(value))
      throw new Error(`Invalid saved preference: ${key} = ${JSON.stringify(value)}`);
  }
  for (const [key, rule] of Object.entries(schema)) {
    const raw = storage.getItem(STORAGE_PREFIX + key);
    // Only a missing key is a first launch. Corrupt data is an error and is never overwritten.
    const value = raw === null ? (key === 'quality' && touch ? 'smooth' : rule.initial) : JSON.parse(raw);
    validate(key, value);
    values[key] = value;
  }
  return {
    get(key) {
      validate(key, values[key]);
      return values[key];
    },
    set(key, value) {
      validate(key, value);
      storage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      values[key] = value;
    },
  };
}
