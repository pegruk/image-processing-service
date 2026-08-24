export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}
