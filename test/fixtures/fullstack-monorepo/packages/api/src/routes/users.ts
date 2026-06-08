import { Hono } from "hono";
import type { Context } from "hono";
import type { User, CreateUserDTO, UpdateUserDTO, ApiResponse, PaginatedResponse } from "../../shared/src/index";
import { validateEmail, validatePassword, PAGINATION_DEFAULTS, ERROR_CODES } from "../../shared/src/index";
import { requireRole } from "../middleware/auth";

export const userRoutes = new Hono();

/**
 * GET /api/users
 * List users with pagination.
 */
userRoutes.get("/", requireRole("admin"), async (c: Context) => {
  const page = Number(c.req.query("page") ?? PAGINATION_DEFAULTS.page);
  const pageSize = Math.min(Number(c.req.query("pageSize") ?? PAGINATION_DEFAULTS.pageSize), PAGINATION_DEFAULTS.maxPageSize);

  // In real app: query database
  const users: User[] = [];
  const totalItems = 0;

  const response: PaginatedResponse<User> = {
    success: true,
    data: users,
    page,
    totalPages: Math.ceil(totalItems / pageSize),
    totalItems,
    timestamp: Date.now(),
  };

  return c.json(response);
});

/**
 * POST /api/users
 * Create a new user.
 */
userRoutes.post("/", async (c: Context) => {
  const body = await c.req.json<CreateUserDTO>();

  // Validate
  if (!body.email || !validateEmail(body.email)) {
    return c.json({ success: false, error: ERROR_CODES.VALIDATION_ERROR, data: null, timestamp: Date.now() } satisfies ApiResponse<null>, 400);
  }

  const pwCheck = validatePassword(body.password);
  if (!pwCheck.valid) {
    return c.json({ success: false, error: pwCheck.reason, data: null, timestamp: Date.now() } satisfies ApiResponse<null>, 400);
  }

  // Create user (mock)
  const user: User = {
    id: crypto.randomUUID(),
    email: body.email,
    name: body.name,
    role: body.role ?? "member",
    createdAt: new Date().toISOString(),
  };

  return c.json({ success: true, data: user, timestamp: Date.now() } satisfies ApiResponse<User>, 201);
});

/**
 * PATCH /api/users/:id
 * Update an existing user.
 */
userRoutes.patch("/:id", requireRole("admin"), async (c: Context) => {
  const id = c.req.param("id");
  const body = await c.req.json<UpdateUserDTO>();

  // In real app: fetch from DB, merge, save
  const updated: Partial<User> = { id, ...body };

  return c.json({ success: true, data: updated, timestamp: Date.now() } satisfies ApiResponse<Partial<User>>);
});
