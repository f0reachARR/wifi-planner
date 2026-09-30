import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { migrationsFolder } from "../paths.js";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/** `url` は `file:/path/to/app.db` か `:memory:` */
export async function openDb(url: string): Promise<Db> {
  const client = createClient({ url });
  if (url !== ":memory:") {
    await client.execute("PRAGMA journal_mode = WAL");
  }
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db;
}
