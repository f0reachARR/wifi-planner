import { EventEmitter } from "node:events";

/**
 * 権限に関わる変更の通知。同期サーバが購読し、権限を失った接続を切る（設計書 10.2 節）。
 * userId を省いた projectAccessChanged は、プロジェクトの全員の権限を確かめ直す合図とする。
 */
type AccessEventMap = {
  userDisabled: [userId: string];
  projectAccessChanged: [projectId: string, userId?: string];
  projectDeleted: [projectId: string];
};

export class AccessEvents extends EventEmitter<AccessEventMap> {}
