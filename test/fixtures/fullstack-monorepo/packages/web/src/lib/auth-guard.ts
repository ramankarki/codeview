import type { UserRole } from "../../shared/src/index";

interface AuthGuardOptions {
  minRole: UserRole;
}

/**
 * Client-side auth guard for route access.
 * In production: checks auth state from context/store.
 */
export function requireAuth(opts: AuthGuardOptions): void {
  // In real app: check auth store / redirect to login
  const currentUser = null; // get from auth context
  const roles: UserRole[] = ["viewer", "member", "admin"];

  if (!currentUser) {
    throw redirect("/login");
  }

  const userLevel = roles.indexOf(currentUser.role);
  const requiredLevel = roles.indexOf(opts.minRole);

  if (userLevel < requiredLevel) {
    throw redirect("/unauthorized");
  }
}

function redirect(path: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: path },
  });
}
