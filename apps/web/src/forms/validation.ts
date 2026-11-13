import type { z } from "zod";

export type FieldErrors<TField extends string = string> = Partial<Record<TField, string>>;

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors: Record<string, string>; firstError: string };

export function validateWithZod<T>(
  schema: z.ZodType<T>,
  input: unknown,
): ValidationResult<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const fieldErrors: Record<string, string> = {};
  let firstError = "Verifique os campos destacados.";

  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
    if (firstError === "Verifique os campos destacados." && issue.message) {
      firstError = issue.message;
    }
  }

  return { ok: false, fieldErrors, firstError };
}
