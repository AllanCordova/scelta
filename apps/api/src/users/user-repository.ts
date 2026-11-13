export type UserRole = "admin" | "member";

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  photoUrl?: string | null;
  role: UserRole;
};

export type StoredUser = PublicUser & {
  passwordHash: string;
};

export type NewUser = {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
};

export class EmailAlreadyUsedError extends Error {
  constructor() {
    super("email_taken");
    this.name = "EmailAlreadyUsedError";
  }
}

export type UserRepository = {
  findByEmail(email: string): Promise<StoredUser | null>;
  insertUser(user: NewUser): Promise<PublicUser>;
  findBySessionToken(token: string | undefined): Promise<PublicUser | null>;
  updateUserProfile?(
    userId: string,
    input: { name: string; photoUrl: string | null },
  ): Promise<PublicUser | null>;
  createSession(userId: string, token: string, expiresAt: Date): Promise<void>;
  deleteSession(token: string): Promise<void>;
};
