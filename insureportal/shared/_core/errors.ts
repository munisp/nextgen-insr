export class AppError extends Error {
  constructor(public code: string, message: string, public statusCode = 400) {
    super(message);
    this.name = "AppError";
  }
}
export const ERRORS = {
  UNAUTHORIZED: new AppError("UNAUTHORIZED", "Unauthorized", 401),
  FORBIDDEN: new AppError("FORBIDDEN", "Forbidden", 403),
  NOT_FOUND: new AppError("NOT_FOUND", "Not found", 404),
  INTERNAL: new AppError("INTERNAL", "Internal server error", 500),
};
