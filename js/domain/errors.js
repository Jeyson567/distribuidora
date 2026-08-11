/**
 * Error whose message is safe and useful to show directly to the operator.
 * Anything else is reported as a generic failure and only logged to console.
 */
export class BusinessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BusinessError';
    this.isBusinessError = true;
  }
}

export const fault = (message) => {
  throw new BusinessError(message);
};

export const userMessage = (error, fallback) =>
  (error?.isBusinessError ? error.message : fallback);
