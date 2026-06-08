import type { Context, Next } from "hono";
import { ERROR_CODES } from "../../shared/src/index";

/**
 * Catches unhandled errors and returns a structured JSON response.
 */
export async function errorHandler(c: Context, next: Next): Promise<void> {
  try {
    await next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[${c.req.method} ${c.req.path}]`, message);

    return c.json({
      success: false,
      error: ERROR_CODES.INTERNAL,
      data: null,
      timestamp: Date.now(),
    }, 500);
  }
}
