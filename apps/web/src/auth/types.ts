export type UserRole = "admin" | "member";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};
