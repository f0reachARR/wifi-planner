import { fileURLToPath } from "node:url";

// このファイルは開発時は src/ に、ビルド後は dist/main.js にバンドルされる。
// どちらもパッケージ直下から 1 階層下なので、同じ相対パスでパッケージ直下を指せる。
export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
