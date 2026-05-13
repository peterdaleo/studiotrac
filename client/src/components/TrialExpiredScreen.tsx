import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Check, Clock, Zap } from "lucide-react";

const PLANS = [
  {
    id: "starter" as const,
    name: "Starter",
    price: "$59",
    period: "/month",
    description: "Perfect for small architecture studios.",
    features: [
      "Up to 10 active projects",
      "Up to 5 team members",
      "Basic time tracking",
      "Client portal",
      "Email notifications",
    ],
    highlight: false,
  },
  {
    id: "professional" as const,
    name: "Professional",
    price: "$179",
    period: "/month",
    description: "For growing firms that need advanced features.",
    features: [
      "Unlimited active projects",
      "Up to 25 team members",
      "Advanced time tracking & reports",
      "Client portal with file sharing",
      "Financial dashboards",
      "Consultant management",
      "Priority support",
    ],
    highlight: true,
  },
];

export default function TrialExpiredScreen() {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  const createCheckout = trpc.subscription.createCheckout.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err) => {
      toast.error(err.message || "Could not start checkout. Please try again.");
      setLoadingPlan(null);
    },
  });

  const handleSubscribe = (plan: "starter" | "professional") => {
    setLoadingPlan(plan);
    createCheckout.mutate({ plan });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-10">
        <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
          <Building2 className="h-5 w-5 text-primary-foreground" />
        </div>
        <span className="text-xl font-semibold tracking-tight">StudioTrac</span>
      </div>

      {/* Expired notice */}
      <div className="text-center mb-10 max-w-md">
        <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-4 py-1.5 text-sm font-medium mb-4">
          <Clock className="h-4 w-4" />
          Your 14-day free trial has ended
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-3">
          Subscribe to continue
        </h1>
        <p className="text-muted-foreground text-base">
          Your trial has expired. Choose a plan below to keep your projects,
          team, and data — everything is still saved.
        </p>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-2xl">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`relative rounded-xl border p-6 flex flex-col gap-4 ${
              plan.highlight
                ? "border-primary shadow-md bg-primary/[0.03]"
                : "border-border bg-card"
            }`}
          >
            {plan.highlight && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 py-0.5 text-xs font-semibold">
                <Zap className="h-3 w-3 mr-1" />
                Most Popular
              </Badge>
            )}
            <div>
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {plan.description}
              </p>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold">{plan.price}</span>
              <span className="text-muted-foreground text-sm">{plan.period}</span>
            </div>
            <ul className="space-y-2 flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button
              className={`w-full mt-2 ${plan.highlight ? "" : "variant-outline"}`}
              variant={plan.highlight ? "default" : "outline"}
              onClick={() => handleSubscribe(plan.id)}
              disabled={loadingPlan !== null}
            >
              {loadingPlan === plan.id ? "Redirecting…" : `Subscribe to ${plan.name}`}
            </Button>
          </div>
        ))}
      </div>

      {/* Enterprise note */}
      <p className="mt-8 text-sm text-muted-foreground text-center">
        Need unlimited team members or custom integrations?{" "}
        <a
          href="mailto:hello@studiotrac.app"
          className="underline underline-offset-2 hover:text-foreground transition-colors"
        >
          Contact us about Enterprise
        </a>
        .
      </p>
    </div>
  );
}
