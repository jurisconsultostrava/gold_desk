import { ReactNode, useEffect, useState } from "react";
import { api, type AppAuthMe } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LockKeyhole, ShieldCheck } from "lucide-react";

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppAuthMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadSession() {
    try {
      const me = await api.authMe();
      setState(me);
    } catch (e: any) {
      setError(e?.message || "Nepodařilo se ověřit přihlášení.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSession();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const me = await api.authLogin(username, password);
      setState(me);
    } catch (e: any) {
      setError(e?.message || "Přihlášení selhalo.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">Ověřuji přístup…</div>
      </div>
    );
  }

  if (!state?.auth_enabled || state?.authenticated) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_hsl(var(--primary)_/_0.16),_transparent_36%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)))] flex items-center justify-center px-4 py-10 text-foreground">
      <Card className="w-full max-w-md border-card-border shadow-lg">
        <CardHeader className="space-y-4">
          <div className="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <LockKeyhole className="size-6" />
          </div>
          <div>
            <CardTitle className="text-2xl">GoldDesk</CardTitle>
            <CardDescription>Privátní vstup do aplikace</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="app-username">Jméno</Label>
              <Input
                id="app-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-password">Heslo</Label>
              <Input
                id="app-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Přihlášení se nepodařilo</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Přihlašuji…" : "Přihlásit se"}
            </Button>
          </form>
          <div className="mt-5 flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 mt-0.5 shrink-0" />
            <p>API, datová schránka, e-mailové účty a AI nástroje jsou dostupné až po přihlášení.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
