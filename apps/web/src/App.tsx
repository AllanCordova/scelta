import { Toaster } from "sonner";
import { AuthProvider } from "./auth/AuthProvider";
import { Shell } from "./shell/Shell";

export function App() {
  return (
    <AuthProvider>
      <Shell />
      <Toaster position="top-center" richColors closeButton />
    </AuthProvider>
  );
}
