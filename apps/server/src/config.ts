import path from "node:path";

export type Config = {
  port: number;
  dataDir: string;
  webDist: string | undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    dataDir: path.resolve(env.DATA_DIR ?? ".data"),
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : undefined,
  };
}
