import type { Context, Next } from "hono";
import type { User, UserRole } from "../../shared/src/index";

/**
 * Attaches user info to request context.
 * In production: validates JWT token and loads user from DB.
 */
export async function authMiddleware(c: Context, next: Next): Promise<void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    // Allow unauthenticated requests through; routes decide what requires auth
    await next();
    return;
  }

  // Mock user for demo
  const user: User = {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin",
    role: "admin" as UserRole,
    createdAt: new Date().toISOString(),
  };

  c.set("currentUser", user);
  await next();
}

/**
 * Route guard: requires a specific minimum role.
 */
export function requireRole(minRole: UserRole) {
  return async (c: Context, next: Next) => {
    const user = c.get("currentUser") as User | undefined;
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const roles: UserRole[] = ["viewer", "member", "admin"];
    const userLevel = roles.indexOf(user.role);
    const requiredLevel = roles.indexOf(minRole);

    if (userLevel < requiredLevel) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    await next();
  };
}
