import { expect, type Page, test } from "@playwright/test";
import { ADMIN } from "../playwright.config";

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("ユーザー名").fill(username);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
}

test("管理者がユーザーを作り、プロジェクトを共有する", async ({ browser }) => {
  const adminPage = await (await browser.newContext()).newPage();
  await login(adminPage, ADMIN.username, ADMIN.password);

  // ユーザーを作る
  await adminPage.getByRole("link", { name: "ユーザー管理" }).click();
  await adminPage.getByRole("button", { name: "ユーザーを作成" }).click();
  const dialog = adminPage.getByRole("dialog");
  await dialog.getByLabel("ユーザー名").fill("bob");
  await dialog.getByLabel("初期パスワード").fill("bob-password");
  await dialog.getByRole("button", { name: "作成" }).click();
  await expect(adminPage.getByRole("cell", { name: "bob" })).toBeVisible();

  // プロジェクトを作ると、エディタ（仮の画面）が開く
  await adminPage.getByRole("link", { name: "WiFi 配置計画" }).click();
  await adminPage.getByRole("button", { name: "新規作成" }).click();
  await adminPage.getByRole("dialog").getByLabel("名前").fill("本社ビル");
  await adminPage.getByRole("dialog").getByRole("button", { name: "作成" }).click();
  await expect(adminPage.getByText("本社ビル")).toBeVisible();
  await expect(adminPage.getByLabel("接続の状態")).toHaveText("同期済み");
  await adminPage.getByRole("link", { name: "プロジェクトの一覧に戻る" }).click();

  // bob にはまだ見えない
  const bobPage = await (await browser.newContext()).newPage();
  await login(bobPage, "bob", "bob-password");
  await expect(bobPage.getByText("プロジェクトがありません")).toBeVisible();

  // 閲覧権限で共有する
  await adminPage
    .getByRole("row", { name: /本社ビル/ })
    .getByRole("button", { name: "操作" })
    .click();
  await adminPage.getByRole("menuitem", { name: "共有" }).click();
  const share = adminPage.getByRole("dialog");
  await share.getByRole("combobox", { name: "ユーザー" }).click();
  await adminPage.getByRole("option", { name: "bob" }).click();
  await share.getByRole("combobox", { name: "権限" }).click();
  await adminPage.getByRole("option", { name: "閲覧" }).click();
  await share.getByRole("button", { name: "追加" }).click();
  await expect(share.getByRole("cell", { name: "bob" })).toBeVisible();

  await bobPage.reload();
  const row = bobPage.getByRole("row", { name: /本社ビル/ });
  await expect(row.getByText("閲覧")).toBeVisible();
  // 閲覧者のメニューには名前の変更がない
  await row.getByRole("button", { name: "操作" }).click();
  await expect(bobPage.getByRole("menuitem", { name: "名前を変更" })).toHaveCount(0);
  await expect(bobPage.getByRole("menuitem", { name: "複製" })).toBeVisible();
});
