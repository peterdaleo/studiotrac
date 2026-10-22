import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Loader2 } from "lucide-react";

type FirmInvitationPreview = { email: string; firmName: string; expiresAt: string | Date };

export default function Signup() {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<FirmInvitationPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const { inviteToken, firmInviteToken } = useMemo(() => {
    if (typeof window === "undefined") return { inviteToken: null, firmInviteToken: null };
    const params = new URLSearchParams(window.location.search);
    return { inviteToken: params.get("invite"), firmInviteToken: params.get("firmInvite") };
  }, []);
  const conflictingInvitations = !!inviteToken && !!firmInviteToken;
  const isFirmInvite = !!firmInviteToken && !conflictingInvitations;
  const hasInvitation = (!!inviteToken || !!firmInviteToken) && !conflictingInvitations;

  useEffect(() => {
    if (!isFirmInvite) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError("");
    fetch("/api/auth/firm-invitation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: firmInviteToken }),
    })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "This firm invitation is not available");
        return data as FirmInvitationPreview;
      })
      .then(value => {
        if (cancelled) return;
        setPreview(value);
        setEmail(value.email);
      })
      .catch(reason => {
        if (!cancelled) setPreviewError(reason instanceof Error ? reason.message : "This firm invitation is not available");
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [firmInviteToken, isFirmInvite]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!hasInvitation) {
      setError("An invitation is required to create an account");
      return;
    }
    if (isFirmInvite && !preview) {
      setError(previewError || "The firm invitation could not be verified");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, ...(inviteToken ? { inviteToken } : {}), ...(firmInviteToken ? { firmInviteToken } : {}) }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Signup failed");
        return;
      }
      // Invited accounts join their assigned workspace and do not enter trial onboarding.
      window.location.href = hasInvitation ? "/" : "/onboarding";
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const invitationUnavailable = conflictingInvitations || (!!firmInviteToken && !!previewError);
  const showForm = hasInvitation && !invitationUnavailable && (!isFirmInvite || !!preview);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
            <Building2 className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">{hasInvitation ? "Accept Invitation" : "Invitation Required"}</CardTitle>
          <CardDescription>
            {isFirmInvite && preview
              ? `You were invited to create an owner account for ${preview.firmName}.`
              : hasInvitation
                ? "Finish setting up your studioTrac account using the email address that received your invitation."
                : "New accounts are created only from a valid team or firm invitation. Contact your workspace owner for an invitation."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {previewLoading && (
            <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground" role="status">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking firm invitation…
            </div>
          )}
          {invitationUnavailable && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" role="alert">
              {conflictingInvitations ? "Use only one invitation link at a time." : previewError}
            </div>
          )}
          {showForm && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" role="alert">{error}</div>}
              {isFirmInvite && preview && (
                <div className="p-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg">
                  Invitation for <strong>{preview.firmName}</strong>. Use the invited email address; this account will receive pending workspace access.
                </div>
              )}
              {inviteToken && !isFirmInvite && (
                <div className="p-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg">
                  You were invited to join a workspace. Use the same email address that received the invitation so your workspace access and role are assigned correctly.
                </div>
              )}
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">Name</label>
                <Input id="name" type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} autoFocus />
              </div>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">Email</label>
                <Input id="email" type="email" placeholder="you@studio.com" value={email} onChange={e => setEmail(e.target.value)} required readOnly={isFirmInvite} />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">Password</label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
              </div>
              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-medium">Confirm Password</label>
                <Input id="confirmPassword" type="password" placeholder="••••••••" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={6} />
              </div>
              <Button type="submit" className="w-full" disabled={loading || (isFirmInvite && !preview)}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {isFirmInvite ? "Create Owner Account" : "Create Account and Join Workspace"}
              </Button>
            </form>
          )}
          <div className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <button onClick={() => navigate("/login")} className="text-primary hover:underline font-medium">Sign in</button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
