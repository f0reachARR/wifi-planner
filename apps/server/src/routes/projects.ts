import {
  CreateProjectRequest,
  DuplicateProjectRequest,
  SetMemberRequest,
  UpdateProjectRequest,
} from "@wifi-planner/api-contract";
import { createEmptyProjectDoc } from "@wifi-planner/domain";
import { encodeProjectDoc } from "@wifi-planner/domain/ydoc";
import { type Context, Hono } from "hono";
import type { AppDeps, AppEnv } from "../app.js";
import { requireUser } from "../auth/session.js";
import { forbidden, notFound, readBody } from "../http.js";
import {
  canEdit,
  createProject,
  getProject,
  listMembers,
  listProjects,
  projectRole,
  removeMember,
  renameProject,
  setMember,
  softDeleteProject,
} from "../repo/projects.js";
import { findUserById } from "../repo/users.js";

export function projectRoutes({ db, docs, events }: AppDeps) {
  const app = new Hono<AppEnv>();

  /** 閲覧できなければ 404 を返す。権限のないユーザーにプロジェクトの存在を知らせない */
  const access = async (c: Context<AppEnv>) => {
    const user = requireUser(c);
    const projectId = c.req.param("id")!;
    const role = await projectRole(db, projectId, user.id);
    if (!role) throw notFound("プロジェクト");
    return { user, projectId, role };
  };

  app.get("/", async (c) => {
    const user = requireUser(c);
    return c.json(await listProjects(db, user.id));
  });

  app.post("/", async (c) => {
    const user = requireUser(c);
    const { name } = await readBody(c, CreateProjectRequest);
    const id = await createProject(db, docs, {
      name,
      ownerId: user.id,
      state: encodeProjectDoc(createEmptyProjectDoc()),
    });
    return c.json(await getProject(db, id, user.id), 201);
  });

  app.get("/:id", async (c) => {
    const { user, projectId } = await access(c);
    return c.json(await getProject(db, projectId, user.id));
  });

  app.patch("/:id", async (c) => {
    const { user, projectId, role } = await access(c);
    if (!canEdit(role)) throw forbidden();
    const { name } = await readBody(c, UpdateProjectRequest);
    await renameProject(db, projectId, name);
    return c.json(await getProject(db, projectId, user.id));
  });

  app.delete("/:id", async (c) => {
    const { projectId, role } = await access(c);
    if (role !== "owner") throw forbidden();
    await softDeleteProject(db, projectId);
    events.emit("projectDeleted", projectId);
    return c.body(null, 204);
  });

  // 複製したプロジェクトは、複製した人が所有する（FR-1.3）
  app.post("/:id/duplicate", async (c) => {
    const { user, projectId } = await access(c);
    const { name } = await readBody(c, DuplicateProjectRequest);
    const state = await docs.getState(projectId);
    if (!state) throw notFound("プロジェクトの文書");
    const id = await createProject(db, docs, { name, ownerId: user.id, state });
    return c.json(await getProject(db, id, user.id), 201);
  });

  app.get("/:id/members", async (c) => {
    const { projectId } = await access(c);
    return c.json(await listMembers(db, projectId));
  });

  app.put("/:id/members/:userId", async (c) => {
    const { user, projectId, role } = await access(c);
    if (role !== "owner") throw forbidden();
    const targetId = c.req.param("userId");
    if (targetId === user.id) throw forbidden();
    const target = await findUserById(db, targetId);
    if (!target || target.disabledAt !== null) throw notFound("ユーザー");
    const { role: memberRole } = await readBody(c, SetMemberRequest);
    await setMember(db, projectId, targetId, memberRole);
    events.emit("projectAccessChanged", projectId, targetId);
    return c.json(await listMembers(db, projectId));
  });

  // 所有者はメンバーを外せる。メンバーは自分でプロジェクトから抜けられる
  app.delete("/:id/members/:userId", async (c) => {
    const { user, projectId, role } = await access(c);
    const targetId = c.req.param("userId");
    if (role !== "owner" && targetId !== user.id) throw forbidden();
    await removeMember(db, projectId, targetId);
    events.emit("projectAccessChanged", projectId, targetId);
    return c.body(null, 204);
  });

  return app;
}
