import { Hono } from "hono";
import type { Context } from "hono";
import { userRoutes } from "./routes/users";
import { productRoutes } from "./routes/products";
import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import { rateLimiter } from "./middleware/rate-limiter";
import { createLogger } from "./lib/logger";

const logger = createLogger("api");

const app = new Hono()
  // Global middleware
  .use("*", errorHandler)
  .use("*", rateLimiter({ windowMs: 60000, maxRequests: 100 }))
  .use("*", authMiddleware)
  // Health check
  .get("/health", (c: Context) => c.json({ status: "ok", uptime: process.uptime() }))
  // Route groups
  .route("/api/users", userRoutes)
  .route("/api/products", productRoutes);

logger.info("App created with routes: /api/users, /api/products");

// Export AppType for Hono RPC clients
export type AppType = typeof app;
export default app;
