import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { type Presence, ProjectSession } from "./session";

const SessionContext = createContext<ProjectSession | undefined>(undefined);

export function ProjectSessionProvider(props: {
  projectId: string;
  user: Presence["user"];
  readOnly: boolean;
  onAccessChanged: () => void;
  children: ReactNode;
}) {
  const { projectId, user, readOnly, onAccessChanged } = props;
  const [session, setSession] = useState<ProjectSession>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: user と onAccessChanged の同一性の変化では作り直さない
  useEffect(() => {
    const s = new ProjectSession(projectId, user, readOnly, onAccessChanged);
    setSession(s);
    return () => s.destroy();
  }, [projectId, user.id, readOnly]);

  if (!session) return null;
  return <SessionContext.Provider value={session}>{props.children}</SessionContext.Provider>;
}

export function useSession(): ProjectSession {
  const s = useContext(SessionContext);
  if (!s) throw new Error("ProjectSessionProvider の外で使われた");
  return s;
}

/** セッションの状態（文書、接続、undo、ほかのユーザー） */
export function useSessionState() {
  const s = useSession();
  return useSyncExternalStore(s.subscribe, s.getSnapshot);
}
