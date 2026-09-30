import { createBrowserRouter } from "react-router";
import { AppLayout, RequireAdmin, RequireLogin } from "./components/AppLayout";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { LoginPage } from "./pages/LoginPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";

export const router = createBrowserRouter([
  { path: "/login", Component: LoginPage },
  {
    Component: RequireLogin,
    children: [
      {
        Component: AppLayout,
        children: [
          { index: true, Component: ProjectsPage },
          {
            path: "admin/users",
            Component: RequireAdmin,
            children: [{ index: true, Component: AdminUsersPage }],
          },
        ],
      },
      // エディタは画面全体を使うので、共通の枠の外に置く
      { path: "projects/:projectId", Component: ProjectPage },
    ],
  },
]);
