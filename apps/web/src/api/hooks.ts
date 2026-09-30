import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApModelEntry,
  CreateUserRequest,
  Member,
  MemberRole,
  Project,
  UpdateUserRequest,
  User,
  UserSummary,
} from "@wifi-planner/api-contract";
import { ApiError, api } from "./client";

export const keys = {
  me: ["me"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  members: (id: string) => ["projects", id, "members"] as const,
  users: ["users"] as const,
  adminUsers: ["admin", "users"] as const,
};

/** ログイン中のユーザー。未ログインなら null */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.get<User>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { username: string; password: string }) =>
      api.post<User>("/auth/login", input),
    onSuccess: (user) => qc.setQueryData(keys.me, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/auth/logout"),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(keys.me, null);
    },
  });
}

export function useProjects() {
  return useQuery({ queryKey: keys.projects, queryFn: () => api.get<Project[]>("/projects") });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: keys.project(id),
    queryFn: () => api.get<Project>(`/projects/${id}`),
  });
}

function useInvalidateProjects() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.projects });
}

export function useCreateProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (name: string) => api.post<Project>("/projects", { name }),
    onSuccess: invalidate,
  });
}

export function useRenameProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<Project>(`/projects/${id}`, { name }),
    onSuccess: invalidate,
  });
}

export function useDuplicateProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.post<Project>(`/projects/${id}/duplicate`, { name }),
    onSuccess: invalidate,
  });
}

export function useDeleteProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/projects/${id}`),
    onSuccess: invalidate,
  });
}

export function useMembers(projectId: string) {
  return useQuery({
    queryKey: keys.members(projectId),
    queryFn: () => api.get<Member[]>(`/projects/${projectId}/members`),
  });
}

export function useSetMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) =>
      api.put<Member[]>(`/projects/${projectId}/members/${userId}`, { role }),
    onSuccess: (members) => qc.setQueryData(keys.members(projectId), members),
  });
}

export function useRemoveMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete<void>(`/projects/${projectId}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(projectId) }),
  });
}

export function useUserSummaries() {
  return useQuery({ queryKey: keys.users, queryFn: () => api.get<UserSummary[]>("/users") });
}

export function useAdminUsers() {
  return useQuery({ queryKey: keys.adminUsers, queryFn: () => api.get<User[]>("/admin/users") });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserRequest) => api.post<User>("/admin/users", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.adminUsers }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateUserRequest & { id: string }) =>
      api.patch<User>(`/admin/users/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.adminUsers }),
  });
}

export function useApModels() {
  return useQuery({
    queryKey: ["ap-models"],
    queryFn: () => api.get<ApModelEntry[]>("/ap-models"),
  });
}

export function useSaveApModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, definition }: { id?: string; definition: unknown }) =>
      id
        ? api.put<ApModelEntry>(`/ap-models/${id}`, definition)
        : api.post<ApModelEntry>("/ap-models", definition),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ap-models"] }),
  });
}

export function useDeleteApModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/ap-models/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ap-models"] }),
  });
}
