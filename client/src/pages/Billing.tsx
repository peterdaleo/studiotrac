import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CreditCard,
  Check,
  Crown,
  Building2,
  Loader2,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export default function Billing() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [changingTo, setChangingTo] = useState<string | null>(null);

  const { data: plans, isLoading: plansLoading } = trpc.subscription.plans.useQuery();
  const { data: currentSubscription, isLoading: subLoading } = trpc.subscription.current.useQuery();

  const createCheckout = trpc.subscription.createCheckout.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const cancelSubscription = trpc.subscription.cancel.useMutation({
    onSuccess: () => {
      utils.subscription.current.invalidate();
      toast.success("Subscription will be canceled at the end of the billing period");
    },
    onError: (err) => toast.error(err.message),
  });

  const resumeSubscription = trpc.subscription.resume.useMutation({
    onSuccess: () => {
      utils.subscription.current.invalidate();
      toast.success("Subscription resumed successfully");
    },
    onError: (err) => toast.error(err.message),
  });

  const changePlan = trpc.subscription.changePlan.useMutation({
    onSuccess: () => {
      utils.subscription.current.invalidate();
      setChangingTo(null);
      toast.success("Plan changed successfully");
    },
    onError: (err) => {
      setChangingTo(null);
      toast.error(err.message);
    },
  });

  const createPortal = trpc.subscription.createPortalSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, "_blank");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // Check for checkout result in URL
  const params = new URLSearchParams(window.location.search);
  const checkoutResult = params.get("checkout");
  if (checkoutResult === "success") {
    // Clean URL
    window.history.replaceState({}, "", window.location.pathname);
    toast.success("Subscription activated successfully!");
  } else if (checkoutResult === "canceled") {
    window.history.replaceState({}, "", window.location.pathname);
  }

  const isLoading = plansLoading || subLoading;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const currentPlan = currentSubscription?.plan ?? null;
  const isActive = currentSubscription?.status === "active";
  const isCanceling = currentSubscription?.cancelAtPeriodEnd;

  function getPlanIcon(planId: string) {
    switch (planId) {
      case "starter": return <CreditCard className="h-6 w-6" />;
      case "professional": return <Crown className="h-6 w-6" />;
      case "enterprise": return <Building2 className="h-6 w-6" />;
      default: return null;
    }
  }

  function getStatusBadge() {
    if (!currentSubscription) return null;
    const { status } = currentSubscription;
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Active</Badge>;
      case "past_due":
        return <Badge variant="destructive">Past Due</Badge>;
      case "canceled":
        return <Badge variant="secondary">Canceled</Badge>;
      case "trialing":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Trial</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing & Subscription</h1>
          <p className="text-muted-foreground mt-1">
            Manage your subscription plan and billing details
          </p>
        </div>
        {currentSubscription && (
          <Button
            variant="outline"
            onClick={() => createPortal.mutate()}
            disabled={createPortal.isPending}
          >
            {createPortal.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4 mr-2" />
            )}
            Manage Billing
          </Button>
        )}
      </div>

      {/* Current Subscription Status */}
      {currentSubscription && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-lg">Current Plan</CardTitle>
                {getStatusBadge()}
              </div>
              {isCanceling && (
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">Cancels at period end</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold capitalize">{currentSubscription.plan}</p>
                {currentSubscription.currentPeriodEnd && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {isCanceling ? "Access until" : "Renews on"}{" "}
                    {new Date(currentSubscription.currentPeriodEnd).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {isCanceling ? (
                  <Button
                    onClick={() => resumeSubscription.mutate()}
                    disabled={resumeSubscription.isPending}
                  >
                    {resumeSubscription.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Resume Subscription
                  </Button>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        Cancel Subscription
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel Subscription?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Your subscription will remain active until the end of the current billing period.
                          You can resume at any time before then.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => cancelSubscription.mutate()}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {cancelSubscription.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Yes, Cancel
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Plan Cards */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          {currentSubscription ? "Change Plan" : "Choose a Plan"}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans?.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const isPopular = plan.id === "professional";

            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col ${
                  isPopular ? "border-primary shadow-lg" : ""
                } ${isCurrent ? "ring-2 ring-primary" : ""}`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground">Most Popular</Badge>
                  </div>
                )}
                <CardHeader className="text-center pb-2">
                  <div className="mx-auto mb-2 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    {getPlanIcon(plan.id)}
                  </div>
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription className="min-h-[40px]">{plan.description}</CardDescription>
                  <div className="mt-4">
                    {plan.amount ? (
                      <div>
                        <span className="text-3xl font-bold">${(plan.amount / 100).toFixed(0)}</span>
                        <span className="text-muted-foreground">/month</span>
                      </div>
                    ) : (
                      <span className="text-2xl font-bold">Custom</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-2">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  {isCurrent ? (
                    <Button className="w-full" disabled variant="secondary">
                      Current Plan
                    </Button>
                  ) : plan.id === "enterprise" ? (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => window.open("mailto:hello@studiotrac.app?subject=Enterprise%20Plan%20Inquiry", "_blank")}
                    >
                      Contact Us
                    </Button>
                  ) : isActive && !isCanceling ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          className="w-full"
                          variant={isPopular ? "default" : "outline"}
                          disabled={changePlan.isPending}
                        >
                          {changePlan.isPending && changingTo === plan.id && (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          )}
                          {currentPlan === "professional" && plan.id === "starter"
                            ? "Downgrade"
                            : "Upgrade"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {currentPlan === "professional" && plan.id === "starter"
                              ? "Downgrade to Starter?"
                              : `Upgrade to ${plan.name}?`}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {currentPlan === "professional" && plan.id === "starter"
                              ? "You'll be moved to the Starter plan. The change will be prorated."
                              : `You'll be upgraded to the ${plan.name} plan at $${(plan.amount! / 100).toFixed(0)}/month. The change will be prorated.`}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              setChangingTo(plan.id);
                              changePlan.mutate({ plan: plan.id as "starter" | "professional" });
                            }}
                          >
                            Confirm Change
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <Button
                      className="w-full"
                      variant={isPopular ? "default" : "outline"}
                      onClick={() => createCheckout.mutate({ plan: plan.id as "starter" | "professional" })}
                      disabled={createCheckout.isPending}
                    >
                      {createCheckout.isPending && (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      )}
                      Subscribe
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
