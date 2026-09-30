import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { Page } from "@playwright/test";
import WebSocket from "ws";
import type * as Y from "yjs";

/** ページのログイン中のユーザーとして、プロジェクトの Yjs 文書を Node から直接書き換える。大きな文書を用意するのに使う */
export async function editDoc(page: Page, projectId: string, fn: (ydoc: Y.Doc) => void) {
  const base = new URL(page.url());
  const cookies = await page.context().cookies();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const socket = new HocuspocusProviderWebsocket({
    url: `ws://${base.host}/collab`,
    WebSocketPolyfill: class extends WebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols, { headers: { cookie } });
      }
    },
  });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: projectId });
  provider.attach();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("同期できない")), 10_000);
    provider.on("synced", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  provider.document.transact(() => fn(provider.document));
  // 送り終わるまで少し待つ
  await new Promise((r) => setTimeout(r, 500));
  provider.destroy();
  socket.destroy();
}
