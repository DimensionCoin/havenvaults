import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) throw new Error("Missing JWT_SECRET");

export type AppClaims = {
  privyId: string;
  userId: string;
  email: string;
};

export function signSession(claims: AppClaims, maxAgeSec: number) {
  return jwt.sign(claims, JWT_SECRET, { expiresIn: maxAgeSec });
}

export function verifySession(token: string): AppClaims | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AppClaims;
  } catch {
    return null;
  }
}
