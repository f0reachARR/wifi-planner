import * as Y from "yjs";
import { ProjectDoc } from "./schema.js";

// プロジェクトの JSON と Y.Doc の相互変換（設計書 2.2 節）。
// 要素は ID をキーにした Y.Map に入れ、要素のフィールドも Y.Map にして、フィールドごとに最後の書き込みが勝つ形で収束させる。
// 頂点列や設定の入れ子のように一体で意味を持つ値は、普通の JSON 値としてフィールド全体を置き換える。

/** 各フィールドを Y.Map にする深さ。1 なら要素のフィールドまで、2 なら ID ごとの要素のフィールドまで Y.Map にする */
type Shape = { [key: string]: "value" | "fields" | "entities" | { entities: Shape } };

/** ルート直下の構造。"entities" は ID → フィールドの Y.Map、{ entities } は要素の中にさらに入れ子の集合を持つ */
const ROOT_SHAPE = {
  meta: "fields",
  settings: "fields",
  materials: "entities",
  apModels: "entities",
  floors: {
    entities: {
      walls: "entities",
      aps: "entities",
      photoPins: "entities",
      holes: "entities",
      areas: "entities",
    },
  },
} as const satisfies Shape;

type Json = unknown;

/** target に obj のフィールドを書き込む。nested に挙げたフィールドは入れ子の Y.Map にする */
function writeFields(target: Y.Map<unknown>, obj: Record<string, Json>, nested: Shape = {}): void {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const shape = nested[key];
    if (shape && shape !== "value") {
      // Y.Map は文書に組み込んでからでないと中身を読み書きしにくいので、先に組み込んでから書く
      const child = new Y.Map<unknown>();
      target.set(key, child);
      writeShaped(child, value as Record<string, Json>, shape);
    } else {
      target.set(key, value);
    }
  }
}

function writeShaped(
  target: Y.Map<unknown>,
  value: Record<string, Json>,
  shape: Shape[string],
): void {
  if (shape === "fields") {
    writeFields(target, value);
    return;
  }
  const inner = typeof shape === "object" ? shape.entities : {};
  for (const [id, entity] of Object.entries(value)) {
    const child = new Y.Map<unknown>();
    target.set(id, child);
    writeFields(child, entity as Record<string, Json>, inner);
  }
}

/** 空の Y.Doc にプロジェクトの内容を書き込む */
export function writeProjectDoc(ydoc: Y.Doc, doc: ProjectDoc): void {
  ydoc.transact(() => {
    for (const [key, shape] of Object.entries(ROOT_SHAPE)) {
      writeShaped(ydoc.getMap(key), doc[key as keyof ProjectDoc] as Record<string, Json>, shape);
    }
  });
}

/** 1 要素を Y.Map として集合に書き込む。要素の追加や複製に使う */
export function setEntity(
  collection: Y.Map<unknown>,
  id: string,
  entity: Record<string, Json>,
  nested: Shape = {},
): void {
  const child = new Y.Map<unknown>();
  collection.set(id, child);
  writeFields(child, entity, nested);
}

/** フロアの要素の入れ子の構造。フロアを追加するときに setEntity へ渡す */
export const FLOOR_SHAPE = ROOT_SHAPE.floors.entities;

/** Y.Map を普通の JSON 値にする。検証はしない */
export function fromY(value: unknown): Json {
  if (value instanceof Y.Map) {
    const out: Record<string, Json> = {};
    for (const [k, v] of value.entries()) out[k] = fromY(v);
    return out;
  }
  return value;
}

/** Y.Doc の内容を JSON にし、スキーマで検証する */
export function readProjectDoc(ydoc: Y.Doc): ProjectDoc {
  const raw: Record<string, Json> = {};
  for (const key of Object.keys(ROOT_SHAPE)) raw[key] = fromY(ydoc.getMap(key));
  return ProjectDoc.parse(raw);
}

/** プロジェクトの内容から、Y.Doc の状態（更新のバイト列）を作る */
export function encodeProjectDoc(doc: ProjectDoc): Uint8Array {
  const ydoc = new Y.Doc();
  writeProjectDoc(ydoc, doc);
  return Y.encodeStateAsUpdate(ydoc);
}

/** 検証に失敗しても例外にせず結果を返す。ほかのクライアントが書いた壊れた値で画面を落とさないために使う */
export function tryReadProjectDoc(ydoc: Y.Doc) {
  const raw: Record<string, Json> = {};
  for (const key of Object.keys(ROOT_SHAPE)) raw[key] = fromY(ydoc.getMap(key));
  return ProjectDoc.safeParse(raw);
}
