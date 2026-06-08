/** Shared API types */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export function formatError(code: number, message: string): string {
  return `[${code}] ${message}`;
}
