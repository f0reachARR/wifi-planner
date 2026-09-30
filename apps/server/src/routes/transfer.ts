import { readFile } from "node:fs/promises";
import { migrateDoc, referencedFiles, UnsupportedSchemaError } from "@wifi-planner/domain";
import { encodeProjectDoc, readProjectDoc } from "@wifi-planner/domain/ydoc";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import * as Y from "yjs";
import type { AppDeps, AppEnv } from "../app.js";
import { requireUser } from "../auth/session.js";
import { sniffMime } from "../files/blobstore.js";
import { notFound } from "../http.js";
import { createProject, getProject, projectRole } from "../repo/projects.js";

const FORMAT = "wifi-planner-project";
const FORMAT_VERSION = 1;
const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;

type Manifest = { format: string; version: number; name: string; exportedAt: string };

/**
 * プロジェクト全体のエクスポートとインポート（FR-1.5、設計書 2.4 節）。
 * ZIP に manifest.json、project.json（文書の JSON）、files/<sha256>（文書が参照するファイル）を入れる。
 */
export function transferRoutes({ db, docs, blobs }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get("/:id/export", async (c) => {
    const user = requireUser(c);
    const projectId = c.req.param("id");
    const role = await projectRole(db, projectId, user.id);
    const project = role && (await getProject(db, projectId, user.id));
    if (!project) throw notFound("プロジェクト");
    const state = await docs.getState(projectId);
    if (!state) throw notFound("プロジェクトの文書");
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, state);
    const doc = readProjectDoc(ydoc);

    const entries: Record<string, Uint8Array> = {};
    const manifest: Manifest = {
      format: FORMAT,
      version: FORMAT_VERSION,
      name: project.name,
      exportedAt: new Date().toISOString(),
    };
    entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
    entries["project.json"] = strToU8(JSON.stringify(doc, null, 2));
    for (const sha of referencedFiles(doc).keys()) {
      if (!(await blobs.find(projectId, sha))) continue;
      entries[`files/${sha}`] = new Uint8Array(await readFile(blobs.pathOf(sha)));
    }
    // 画像はすでに圧縮されているので、ファイルは圧縮せずに入れる
    const zip = zipSync(entries, { level: 0 });
    const filename = encodeURIComponent(`${project.name}.wifiplan.zip`);
    return c.body(zip as Uint8Array<ArrayBuffer>, 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename*=UTF-8''${filename}`,
    });
  });

  app.post("/import", bodyLimit({ maxSize: MAX_IMPORT_BYTES }), async (c) => {
    const user = requireUser(c);
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File))
      throw new HTTPException(400, { message: "ファイルを指定してください" });

    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    } catch {
      throw new HTTPException(400, { message: "ZIP を読めません" });
    }
    const readJson = (name: string) => {
      const data = entries[name];
      if (!data) throw new HTTPException(400, { message: `${name} がありません` });
      try {
        return JSON.parse(strFromU8(data));
      } catch {
        throw new HTTPException(400, { message: `${name} を読めません` });
      }
    };
    const manifest = readJson("manifest.json") as Manifest;
    if (manifest.format !== FORMAT || manifest.version > FORMAT_VERSION) {
      throw new HTTPException(400, {
        message: "このアプリのエクスポートではないか、新しすぎる形式です",
      });
    }
    let doc: ReturnType<typeof migrateDoc>;
    try {
      doc = migrateDoc(readJson("project.json"));
    } catch (e) {
      throw new HTTPException(400, {
        message:
          e instanceof UnsupportedSchemaError ? e.message : "プロジェクトの内容が正しくありません",
      });
    }

    // 文書が参照するファイルがすべてあり、名前と中身のハッシュが一致することを確かめてから保存する
    const needed = referencedFiles(doc);
    const saved: { sha: string; kind: typeof needed extends Map<string, infer K> ? K : never }[] =
      [];
    for (const [sha, kind] of needed) {
      const data = entries[`files/${sha}`];
      if (!data)
        throw new HTTPException(400, { message: `ファイル ${sha.slice(0, 8)}… がありません` });
      const mime = sniffMime(data);
      if (!mime)
        throw new HTTPException(400, {
          message: `ファイル ${sha.slice(0, 8)}… の形式を判定できません`,
        });
      const put = await blobs.put(data, mime);
      if (put !== sha)
        throw new HTTPException(400, {
          message: `ファイル ${sha.slice(0, 8)}… の中身が名前と一致しません`,
        });
      saved.push({ sha, kind });
    }
    const name =
      typeof manifest.name === "string" && manifest.name.trim()
        ? manifest.name.trim().slice(0, 200)
        : "インポートしたプロジェクト";
    const id = await createProject(db, docs, {
      name,
      ownerId: user.id,
      state: encodeProjectDoc(doc),
    });
    for (const f of saved) await blobs.link(id, f.sha, f.kind);
    return c.json(await getProject(db, id, user.id), 201);
  });

  return app;
}
