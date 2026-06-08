// === API Response Types ===

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  timestamp: number;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  page: number;
  totalPages: number;
  totalItems: number;
}

// === User Types ===

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: string;
}

export enum UserRole {
  Admin = "admin",
  Member = "member",
  Viewer = "viewer",
}

export interface CreateUserDTO {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
}

export interface UpdateUserDTO {
  name?: string;
  role?: UserRole;
  avatarUrl?: string;
}

// === Product Types ===

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: Currency;
  inStock: boolean;
  categoryId: string;
  images: string[];
}

export enum Currency {
  USD = "USD",
  EUR = "EUR",
  GBP = "GBP",
}

// === Validation ===

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 8) return { valid: false, reason: "Too short (min 8 chars)" };
  if (!/[A-Z]/.test(password)) return { valid: false, reason: "Missing uppercase letter" };
  if (!/[0-9]/.test(password)) return { valid: false, reason: "Missing number" };
  return { valid: true };
}

// === Constants ===

export const PAGINATION_DEFAULTS = {
  page: 1,
  pageSize: 20,
  maxPageSize: 100,
} as const;

export const ERROR_CODES = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  INTERNAL: "INTERNAL_ERROR",
} as const;
