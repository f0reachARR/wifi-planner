import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import type { ProjectDoc } from "@wifi-planner/domain";
import { tryReadProjectDoc } from "@wifi-planner/domain/ydoc";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

/** 権限の変更でサーバが WebSocket を閉じたときのコード。サーバの collab.ts と揃える */
const ACCESS_CHANGED_CODE = 4001;

/** 自分の操作の origin。UndoManager はこの origin の変更だけを戻す（FR-10.5） */
export const LOCAL_ORIGIN = Symbol("local");

export type ConnectionState = "connecting" | "connected" | "offline" | "denied";

/** awareness に載せる、ほかのユーザーに見せる自分の状態（設計書 10.3 節） */
export type Presence = {
  user: { id: string; name: string; color: string };
  floorId?: string;
  /** カーソルの図面座標 */
  cursor?: { x: number; y: number };
  selection?: string[];
  /** ドラッグ中の壁の仮の移動量（図面座標）。手を離すまでは文書に書かない（設計書 10.3 節） */
  drag?: { wallIds: string[]; dx: number; dy: number };
};

export type PeerPresence = Presence & { clientId: number };

type Snapshot = {
  doc: ProjectDoc | undefined;
  state: ConnectionState;
  synced: boolean;
  canUndo: boolean;
  canRedo: boolean;
  peers: PeerPresence[];
};

const PALETTE = [
  "#e03131",
  "#2f9e44",
  "#1971c2",
  "#f08c00",
  "#9c36b5",
  "#0c8599",
  "#c2255c",
  "#5c940d",
];

export function colorForUser(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/**
 * 1 プロジェクトの共同編集のセッション。Y.Doc、同期、ブラウザへの保存、undo、awareness をまとめる。
 * React からは subscribe と getSnapshot で状態を読む。
 */
export class ProjectSession {
  readonly ydoc = new Y.Doc();
  readonly provider: HocuspocusProvider;
  readonly undoManager: Y.UndoManager;
  private readonly persistence: IndexeddbPersistence;
  private readonly listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private destroyed = false;
  /** コンストラクタの途中で provider のコールバックが呼ばれても、作りかけの状態を読まないようにする */
  private ready = false;

  constructor(
    readonly projectId: string,
    readonly user: Presence["user"],
    readonly readOnly: boolean,
    /** 権限の変更でサーバが接続を閉じたときに呼ぶ。呼び出し側は権限を取り直してセッションを作り直す */
    onAccessChanged: () => void,
  ) {
    // 切断中も編集を続けられるよう、文書をブラウザにも保存する（FR-10.4）
    this.persistence = new IndexeddbPersistence(`wifi-planner:${projectId}`, this.ydoc);

    const scheme = location.protocol === "https:" ? "wss" : "ws";
    this.provider = new HocuspocusProvider({
      url: `${scheme}://${location.host}/collab`,
      name: projectId,
      document: this.ydoc,
      onStatus: ({ status }) => {
        this.wsStatus = status;
        this.refresh();
      },
      onSynced: () => this.refresh(),
      onAuthenticationFailed: () => this.refresh({ state: "denied" }),
      onAuthenticated: () => {
        this.denied = false;
        this.refresh();
      },
      onClose: ({ event }) => {
        if (event.code === ACCESS_CHANGED_CODE) onAccessChanged();
      },
    });

    this.undoManager = new Y.UndoManager(
      ["settings", "materials", "apModels", "floors"].map((k) => this.ydoc.getMap(k)),
      { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 400 },
    );
    this.undoManager.on("stack-item-added", () => this.refresh());
    this.undoManager.on("stack-item-popped", () => this.refresh());

    this.ydoc.on("update", () => {
      this.docDirty = true;
      this.refresh();
    });
    this.provider.awareness?.on("change", () => this.refresh());
    this.setPresence({});

    this.snapshot = this.build();
    this.ready = true;
  }

  private denied = false;
  /** 文書が前回の読み取りから変わったか。awareness や接続の状態だけが変わったときは文書を読み直さない */
  private docDirty = true;
  private wsStatus: WebSocketStatus = WebSocketStatus.Connecting;

  private readDoc() {
    if (!this.docDirty && this.snapshot) return this.snapshot.doc;
    this.docDirty = false;
    const parsed = tryReadProjectDoc(this.ydoc);
    // ほかのクライアントが書いた壊れた値で画面を落とさないよう、検証に失敗したら直前の状態を使う
    if (!parsed.success) {
      console.warn("文書の検証に失敗", parsed.error);
      return this.snapshot?.doc;
    }
    return parsed.data;
  }

  private build(): Snapshot {
    const status = this.wsStatus;
    const state: ConnectionState = this.denied
      ? "denied"
      : status === WebSocketStatus.Connected && this.provider.isAuthenticated
        ? "connected"
        : status === WebSocketStatus.Disconnected
          ? "offline"
          : "connecting";
    return {
      doc: this.readDoc(),
      state,
      synced: this.provider.isSynced,
      canUndo: this.undoManager.canUndo(),
      canRedo: this.undoManager.canRedo(),
      peers: this.readPeers(),
    };
  }

  private readPeers(): PeerPresence[] {
    const awareness = this.provider.awareness;
    if (!awareness) return [];
    const peers: PeerPresence[] = [];
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID || !state.user) continue;
      peers.push({ ...(state as Presence), clientId });
    }
    return peers;
  }

  private refresh(patch: Partial<Snapshot> = {}) {
    if (patch.state === "denied") this.denied = true;
    if (this.destroyed || !this.ready) return;
    this.snapshot = this.build();
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /**
   * 自分の操作として文書を書き換える。閲覧者のときは何もしない。
   * 既定では 1 回の呼び出しを 1 つの undo の単位にする。
   * 数値の入力のように続けて呼ばれる変更は coalesce を指定し、短い間隔の変更を 1 つにまとめる。
   */
  mutate(fn: (ydoc: Y.Doc) => void, opts: { coalesce?: boolean } = {}) {
    if (this.readOnly) return;
    if (!opts.coalesce) this.undoManager.stopCapturing();
    this.ydoc.transact(() => fn(this.ydoc), LOCAL_ORIGIN);
    if (!opts.coalesce) this.undoManager.stopCapturing();
  }

  undo = () => this.undoManager.undo();
  redo = () => this.undoManager.redo();

  /** 連続した操作（ドラッグなど）を一つの undo の単位にするため、ここで区切る */
  stopCapturing = () => this.undoManager.stopCapturing();

  setPresence(patch: Partial<Omit<Presence, "user">>) {
    const awareness = this.provider.awareness;
    if (!awareness) return;
    const current = (awareness.getLocalState() ?? {}) as Partial<Presence>;
    awareness.setLocalState({ ...current, ...patch, user: this.user });
  }

  /** 権限を失ったときに、ブラウザに残した文書を消す */
  async clearLocalCopy() {
    await this.persistence.clearData();
  }

  destroy() {
    this.destroyed = true;
    this.undoManager.destroy();
    this.provider.destroy();
    void this.persistence.destroy();
    this.ydoc.destroy();
  }
}
