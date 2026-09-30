import { hash, verify } from "@node-rs/argon2";

export const hashPassword = (password: string) => hash(password);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** 存在しないユーザーでも検証と同じだけ時間をかけ、応答時間からユーザー名の有無を推測されにくくする */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hash("dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
}
