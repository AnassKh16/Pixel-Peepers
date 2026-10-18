export class DomainError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    Object.assign(this, {status, code, details});
  }
}
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const validId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(value);
export const integerAtLeast = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;
export function validationError(fields) {
  throw new DomainError(400, 'VALIDATION_ERROR', 'Invalid request fields', {fields: [...new Set(fields)]});
}

// PostgreSQL text/JSON cannot represent NUL or unpaired UTF-16 surrogates.
export const databaseText = value => typeof value === 'string' && !value.includes('\0') && Buffer.from(value,'utf8').toString('utf8') === value;
