import type { PhotoUploadResult, Project } from "@wifi-planner/api-contract";
import exifReader from "exif-reader";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./test/harness.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => {
  t = await createTestApp();
});

describe("現場写真（FR-9.1、FR-9.4）", () => {
  it("撮影日時を EXIF から読み、保存する画像からは位置情報を取り除く", async () => {
    const { api } = await t.addUser("alice");
    const project = (await (await api.post("/api/projects", { name: "p" })).json()) as Project;
    const jpeg = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: "#88aacc" },
    })
      .jpeg()
      .withExif({
        IFD2: { DateTimeOriginal: "2026:09:01 14:23:05", OffsetTimeOriginal: "+09:00" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "35/1 40/1 0/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "139/1 45/1 0/1",
        },
      })
      .toBuffer();
    expect(exifReader((await sharp(jpeg).metadata()).exif!).GPSInfo).toBeDefined();

    const res = await api.upload(
      `/api/projects/${project.id}/photos`,
      new Uint8Array(jpeg),
      "a.jpg",
    );
    expect(res.status).toBe(201);
    const photo = (await res.json()) as PhotoUploadResult;
    expect(photo.takenAt).toBe("2026-09-01T14:23:05+09:00");

    const stored = new Uint8Array(
      await (await api.get(`/api/projects/${project.id}/files/${photo.sha256}`)).arrayBuffer(),
    );
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBe(2560);
    const thumb = await sharp(
      new Uint8Array(
        await (
          await api.get(`/api/projects/${project.id}/files/${photo.thumbSha256}`)
        ).arrayBuffer(),
      ),
    ).metadata();
    expect(thumb.width).toBe(320);
  });

  it("閲覧者はアップロードできない", async () => {
    const alice = await t.addUser("alice");
    const bob = await t.addUser("bob");
    const project = (await (
      await alice.api.post("/api/projects", { name: "p" })
    ).json()) as Project;
    await alice.api.put(`/api/projects/${project.id}/members/${bob.user.id}`, { role: "viewer" });
    const jpeg = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
      .jpeg()
      .toBuffer();
    expect(
      (await bob.api.upload(`/api/projects/${project.id}/photos`, new Uint8Array(jpeg), "a.jpg"))
        .status,
    ).toBe(403);
  });
});
