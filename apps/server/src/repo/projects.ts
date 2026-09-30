import { randomUUID } from "node:crypto";
import type { Member, MemberRole, Project, ProjectRole } from "@wifi-planner/api-contract";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { projectMembers, projects, users } from "../db/schema.js";
import type { DocStore } from "../docstore.js";

/** ユーザーのプロジェクトでの権限。削除済みのプロジェクトや、権限のないユーザーには undefined を返す */
export async function projectRole(
  db: Db,
  projectId: string,
  userId: string,
): Promise<ProjectRole | undefined> {
  const rows = await db
    .select({ ownerId: projects.ownerId, role: projectMembers.role })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
    )
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  if (row.ownerId === userId) return "owner";
  return row.role ?? undefined;
}

export const canEdit = (role: ProjectRole | undefined) => role === "owner" || role === "editor";

const projectColumns = {
  id: projects.id,
  name: projects.name,
  ownerId: projects.ownerId,
  ownerName: users.username,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
  memberRole: projectMembers.role,
};

type ProjectRowWithRole = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  createdAt: number;
  updatedAt: number;
  memberRole: MemberRole | null;
};

const toProject = (row: ProjectRowWithRole, userId: string): Project => ({
  id: row.id,
  name: row.name,
  owner: { id: row.ownerId, username: row.ownerName },
  role: row.ownerId === userId ? "owner" : (row.memberRole ?? "viewer"),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** ユーザーが所有するか、共有されたプロジェクトの一覧 */
export async function listProjects(db: Db, userId: string): Promise<Project[]> {
  const rows = await db
    .select(projectColumns)
    .from(projects)
    .innerJoin(users, eq(users.id, projects.ownerId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
    )
    .where(
      and(
        isNull(projects.deletedAt),
        or(eq(projects.ownerId, userId), eq(projectMembers.userId, userId)),
      ),
    )
    .orderBy(desc(projects.updatedAt));
  return rows.map((r) => toProject(r, userId));
}

export async function getProject(db: Db, projectId: string, userId: string) {
  const rows = await db
    .select(projectColumns)
    .from(projects)
    .innerJoin(users, eq(users.id, projects.ownerId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
    )
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  const row = rows[0];
  return row ? toProject(row, userId) : undefined;
}

/** プロジェクトを作り、Yjs 文書の初期状態も同時に保存する */
export async function createProject(
  db: Db,
  docs: DocStore,
  input: { name: string; ownerId: string; state: Uint8Array },
): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await db.insert(projects).values({
    id,
    name: input.name,
    ownerId: input.ownerId,
    createdAt: now,
    updatedAt: now,
  });
  await docs.putState(id, input.state);
  return id;
}

export async function renameProject(db: Db, projectId: string, name: string) {
  await db.update(projects).set({ name, updatedAt: Date.now() }).where(eq(projects.id, projectId));
}

export async function softDeleteProject(db: Db, projectId: string) {
  await db.update(projects).set({ deletedAt: Date.now() }).where(eq(projects.id, projectId));
}

export async function listMembers(db: Db, projectId: string): Promise<Member[]> {
  const rows = await db
    .select({ id: users.id, username: users.username, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(users.username));
  return rows.map((r) => ({ user: { id: r.id, username: r.username }, role: r.role }));
}

export async function setMember(db: Db, projectId: string, userId: string, role: MemberRole) {
  await db
    .insert(projectMembers)
    .values({ projectId, userId, role })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { role },
    });
}

export async function removeMember(db: Db, projectId: string, userId: string) {
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}
