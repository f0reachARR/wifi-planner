import { readFileSync } from "node:fs";
import { build } from "esbuild";

// ワークスペースのパッケージ（TypeScript のソースのまま公開している）だけをバンドルし、
// 外部の依存はすべて node_modules から読む。ネイティブモジュールや WASM を含む依存をバンドルせずに済み、
// yjs のように複数の実体があると壊れるライブラリも一つにできる。
// 実行時の依存は dist/main.js から解決されるので、ワークスペースのパッケージが使う外部の依存も
// このパッケージの dependencies に並べておく必要がある。
const externalizeDependencies = {
  name: "externalize-dependencies",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith("@wifi-planner/") ? undefined : { path: args.path, external: true },
    );
  },
};

const result = await build({
  entryPoints: { main: "src/main.ts", "raster-worker": "src/raster-worker.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  plugins: [externalizeDependencies],
  metafile: true,
});

// 外部に出した依存が dependencies に並んでいるかを確かめる。漏れていると本番のイメージで起動に失敗する
const { dependencies = {} } = JSON.parse(readFileSync("package.json", "utf8"));
const packageName = (spec) =>
  spec
    .split("/")
    .slice(0, spec.startsWith("@") ? 2 : 1)
    .join("/");
const missing = new Set();
for (const output of Object.values(result.metafile.outputs)) {
  for (const imp of output.imports) {
    if (imp.external && !imp.path.startsWith("node:") && !(packageName(imp.path) in dependencies)) {
      missing.add(packageName(imp.path));
    }
  }
}
if (missing.size > 0) {
  console.error(`dependencies に足りない依存がある: ${[...missing].join(", ")}`);
  process.exit(1);
}
