import { expect, test } from "@playwright/test";
import { ADMIN } from "../playwright.config";
import { apiOf, ensureUser, newUserPage } from "./helpers";

test("同時編集、自分の操作だけの undo、切断中の編集の統合、閲覧者の制限", async ({ browser }) => {
  const bob = await ensureUser(browser, "collab-bob", "bob-password");
  const carol = await ensureUser(browser, "collab-carol", "carol-password");

  const alice = await newUserPage(browser, ADMIN.username, ADMIN.password);
  const project = await apiOf(alice).post<{ id: string }>("/projects", { name: "同時編集" });
  await apiOf(alice).put(`/projects/${project.id}/members/${bob.id}`, { role: "editor" });
  await apiOf(alice).put(`/projects/${project.id}/members/${carol.id}`, { role: "viewer" });

  const bobPage = await newUserPage(browser, "collab-bob", "bob-password");
  // bob の WebSocket を中継し、テストから切断できるようにする
  let bobOffline = false;
  const bobSockets: { close: () => Promise<void> }[] = [];
  await bobPage.routeWebSocket(/\/collab$/, (ws) => {
    if (bobOffline) {
      void ws.close();
      return;
    }
    ws.connectToServer();
    bobSockets.push(ws);
  });
  await alice.goto(`/projects/${project.id}`);
  await bobPage.goto(`/projects/${project.id}`);
  await expect(alice.getByLabel("接続の状態")).toHaveText("同期済み");
  await expect(bobPage.getByLabel("接続の状態")).toHaveText("同期済み");

  // 参加中のユーザーが互いに見える（FR-10.3）
  await expect(alice.getByLabel("collab-bob が参加中")).toBeVisible();
  await expect(bobPage.getByLabel("admin が参加中")).toBeVisible();

  // 片方の変更がもう片方に反映される（FR-10.1）
  await alice.getByRole("button", { name: "追加" }).click();
  await expect(bobPage.getByRole("button", { name: "1F", exact: true })).toBeVisible();

  // bob がフロアの名前を変え、alice がフロアを足してから undo すると、alice の追加だけが戻る（FR-10.5）
  await bobPage.getByRole("button", { name: "1F の操作" }).click();
  await bobPage.getByRole("menuitem", { name: "設定" }).click();
  await bobPage.getByRole("dialog").getByLabel("名前").fill("地上階");
  await bobPage.getByRole("dialog").getByRole("button", { name: "保存" }).click();
  await expect(alice.getByRole("button", { name: "地上階", exact: true })).toBeVisible();

  await alice.getByRole("button", { name: "追加" }).click();
  await expect(bobPage.getByRole("button", { name: "2F", exact: true })).toBeVisible();
  await alice.getByRole("button", { name: "元に戻す" }).click();
  await expect(bobPage.getByRole("button", { name: "2F", exact: true })).toHaveCount(0);
  await expect(bobPage.getByRole("button", { name: "地上階", exact: true })).toBeVisible();

  // 切断中の変更は再接続後に統合される（FR-10.4）
  bobOffline = true;
  for (const ws of bobSockets.splice(0)) await ws.close();
  await expect(bobPage.getByLabel("接続の状態")).not.toHaveText("同期済み");
  await bobPage.getByRole("button", { name: "追加" }).click();
  await expect(bobPage.getByRole("button", { name: "2F", exact: true })).toBeVisible();
  await expect(alice.getByRole("button", { name: "2F", exact: true })).toHaveCount(0);
  bobOffline = false;
  await expect(alice.getByRole("button", { name: "2F", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  if (process.env.SCREENSHOT_DIR) {
    await alice.screenshot({ path: `${process.env.SCREENSHOT_DIR}/editor.png` });
  }

  // 閲覧者には内容が見えるが、編集の操作は出ない
  const carolPage = await newUserPage(browser, "collab-carol", "carol-password");
  await carolPage.goto(`/projects/${project.id}`);
  await expect(carolPage.getByText("閲覧のみ")).toBeVisible();
  await expect(carolPage.getByRole("button", { name: "地上階", exact: true })).toBeVisible();
  await expect(carolPage.getByRole("button", { name: "追加" })).toHaveCount(0);
  await expect(carolPage.getByRole("button", { name: "元に戻す" })).toHaveCount(0);

  // 共有を外すと、開いている画面も権限なしの表示に変わる
  await alice.request.delete(`/api/projects/${project.id}/members/${carol.id}`, {
    headers: { "x-wifi-planner": "1" },
  });
  await expect(
    carolPage
      .getByText("このプロジェクトを開く権限がありません")
      .or(carolPage.getByText("プロジェクトが見つかりません")),
  ).toBeVisible({
    timeout: 15_000,
  });
});
