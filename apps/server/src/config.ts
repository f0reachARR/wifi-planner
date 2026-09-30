import path from "node:path";

export type Config = {
  port: number;
  dataDir: string;
  webDist: string | undefined;
  adminUsername: string;
  adminPassword: string | undefined;
  /** HTTPS の背後で動かすときは true にし、Cookie に Secure を付ける */
  cookieSecure: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    dataDir: path.resolve(env.DATA_DIR ?? ".data"),
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : undefined,
    adminUsername: env.ADMIN_USERNAME ?? "admin",
    adminPassword: env.ADMIN_PASSWORD || undefined,
    cookieSecure: env.COOKIE_SECURE === "true",
  };
}
