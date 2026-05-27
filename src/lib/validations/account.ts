// src/lib/validations/account.ts
// Account request validation schemas.

import { z } from "zod/v4";

export const createAccountSchema = z.object({
  username: z
    .string()
    .min(1, "Username is required")
    .max(15, "Username must be 15 chars or less")
    .regex(/^[a-zA-Z0-9_]+$/, "Invalid username format"),
  cookies: z.string().min(1, "Cookies are required"),
  displayName: z.string().max(50).optional(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  displayName: z.string().max(50).optional(),
  cookies: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
