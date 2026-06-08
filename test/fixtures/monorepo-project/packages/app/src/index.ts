import type { ApiResponse } from "../../shared/src/index";
import { formatError } from "../../shared/src/index";
import type { User, CreateUserParams } from "./types";

/**
 * Create a new user and return the API response.
 */
export function createUser(params: CreateUserParams): ApiResponse<User> {
  if (!params.email) {
    return { success: false, data: null as unknown as User, error: formatError(400, "Email required") };
  }

  const user: User = {
    id: Math.random().toString(36),
    email: params.email,
    name: params.name ?? "Anonymous",
  };

  return { success: true, data: user };
}
