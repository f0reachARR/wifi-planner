import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

/** 要求の本文を JSON として読み、スキーマで検証する。失敗したら 400 を返す */
export async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new HTTPException(400, {
      message: result.error.issues[0]?.message ?? "入力が正しくありません",
    });
  }
  return result.data;
}

export const notFound = (what = "対象") =>
  new HTTPException(404, { message: `${what}が見つかりません` });
export const forbidden = () => new HTTPException(403, { message: "この操作の権限がありません" });
