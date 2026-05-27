// src/lib/validations/auth.ts
// Auth request validation schemas.

import { z } from "zod/v4";

export const loginSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const setupSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type SetupInput = z.infer<typeof setupSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
