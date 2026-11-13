import { AuthProvider } from "./auth/AuthProvider";
import { Shell } from "./shell/Shell";

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
