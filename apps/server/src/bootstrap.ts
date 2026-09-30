import type { Db } from "./db/client.js";
import { countUsers, createUser } from "./repo/users.js";

/** ユーザーが一人もいないときだけ、環境変数の値で最初の管理者を作る */
export async function ensureInitialAdmin(
  db: Db,
  username: string,
  password: string | undefined,
): Promise<void> {
  if ((await countUsers(db)) > 0) return;
  if (!password) {
    console.warn(
      "ユーザーがいません。ADMIN_PASSWORD を指定して起動し直すと、最初の管理者を作ります",
    );
    return;
  }
  await createUser(db, { username, password, isAdmin: true });
  console.log(`最初の管理者 ${username} を作りました`);
}
