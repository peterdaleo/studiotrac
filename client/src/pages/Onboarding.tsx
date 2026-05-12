import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building2,
  Users,
  CreditCard,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Rocket,
} from "lucide-react";

const STEPS = [
  { id: "welcome", label: "Welcome", icon: Sparkles },
  { id: "firm", label: "Your Firm", icon: Building2 },
  { id: "team", label: "Invite Team", icon: Users },
  { id: "plan", label: "Choose Plan", icon: CreditCard },
  { id: "done", label: "All Set", icon: CheckCircle2 },
] as const;

const FIRM_SIZES = [
  { value: "1", label: "Just me" },
  { value: "2-5", label: "2–5 people" },
  { value: "6-15", label: "6–15 people" },
  { value: "16-50", label: "16–50 people" },
  { value: "51+", label: "51+ people" },
];

const PLANS = [
  {
    id: "starter" as const,
    name: "Starter",
    price: "$59",
    period: "/month",
    description: "For small firms getting started",
    features: ["Up to 5 team members", "10 active projects", "Basic time tracking", "Email support"],
  },
  {
    id: "professional" as const,
    name: "Professional",
    price: "$179",
    period: "/month",
    description: "For growing architecture firms",
    features: ["Unlimited team members", "Unlimited projects", "Advanced analytics & reports", "Priority support", "Client portal"],
    popular: true,
  },
  {
    id: "enterprise" as const,
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For large firms with custom needs",
    features: ["Everything in Professional", "Dedicated account manager", "Custom integrations", "SLA guarantee", "On-premise option"],
  },
];

export default function Onboarding() {
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState(0);
  const [firmName, setFirmName] = useState("");
  const [firmSize, setFirmSize] = useState("");
  const [teamMembers, setTeamMembers] = useState<{ name: string; email: string }[]>([{ name: "", email: "" }]);
  const [selectedPlan, setSelectedPlan] = useState<"starter" | "professional" | "enterprise" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateFirmMutation = trpc.onboarding.updateFirm.useMutation();
  const inviteMembersMutation = trpc.onboarding.inviteMembers.useMutation();
  const completeMutation = trpc.onboarding.complete.useMutation();
  const createCheckoutMutation = trpc.subscription.createCheckout.useMutation();

  const stepIndex = STEPS.findIndex((s) => s.id === STEPS[currentStep].id);

  const canProceed = () => {
    switch (STEPS[currentStep].id) {
      case "welcome":
        return true;
      case "firm":
        return firmName.trim().length > 0 && firmSize.length > 0;
      case "team":
        return true; // Can always skip
      case "plan":
        return true; // Can always skip
      case "done":
        return true;
      default:
        return true;
    }
  };

  const handleNext = async () => {
    if (STEPS[currentStep].id === "firm") {
      setIsSubmitting(true);
      try {
        await updateFirmMutation.mutateAsync({ firmName: firmName.trim(), firmSize });
      } catch (e) {
        console.error("Failed to update firm:", e);
      }
      setIsSubmitting(false);
    }

    if (STEPS[currentStep].id === "team") {
      const validMembers = teamMembers.filter((m) => m.name.trim() && m.email.trim());
      if (validMembers.length > 0) {
        setIsSubmitting(true);
        try {
          await inviteMembersMutation.mutateAsync({ members: validMembers });
        } catch (e) {
          console.error("Failed to invite members:", e);
        }
        setIsSubmitting(false);
      }
    }

    if (STEPS[currentStep].id === "plan" && selectedPlan && selectedPlan !== "enterprise") {
      setIsSubmitting(true);
      try {
        const result = await createCheckoutMutation.mutateAsync({ plan: selectedPlan });
        if (result.url) {
          // Mark onboarding complete before redirecting to Stripe
          await completeMutation.mutateAsync();
          window.location.href = result.url;
          return;
        }
      } catch (e) {
        console.error("Failed to create checkout:", e);
      }
      setIsSubmitting(false);
    }

    if (STEPS[currentStep].id === "done") {
      setIsSubmitting(true);
      try {
        await completeMutation.mutateAsync();
      } catch (e) {
        console.error("Failed to complete onboarding:", e);
      }
      navigate("/");
      return;
    }

    setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const addTeamMember = () => {
    setTeamMembers((prev) => [...prev, { name: "", email: "" }]);
  };

  const removeTeamMember = (index: number) => {
    setTeamMembers((prev) => prev.filter((_, i) => i !== index));
  };

  const updateTeamMember = (index: number, field: "name" | "email", value: string) => {
    setTeamMembers((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30 flex flex-col">
      {/* Progress bar */}
      <div className="w-full px-6 pt-8 pb-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const isActive = index === currentStep;
              const isCompleted = index < currentStep;
              return (
                <div key={step.id} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 scale-110"
                          : isCompleted
                          ? "bg-primary/90 text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                    </div>
                    <span
                      className={`text-xs mt-1.5 font-medium transition-colors ${
                        isActive ? "text-primary" : isCompleted ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {index < STEPS.length - 1 && (
                    <div className="flex-1 mx-2 mt-[-1.25rem]">
                      <div className={`h-0.5 rounded-full transition-colors ${index < currentStep ? "bg-primary" : "bg-muted"}`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center px-6 pb-8">
        <div className="w-full max-w-xl">
          {/* Step 1: Welcome */}
          {STEPS[currentStep].id === "welcome" && (
            <div className="text-center space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="mx-auto w-20 h-20 bg-primary/10 rounded-2xl flex items-center justify-center">
                <Building2 className="w-10 h-10 text-primary" />
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl font-bold tracking-tight">Welcome to StudioTrac</h1>
                <p className="text-lg text-muted-foreground max-w-md mx-auto">
                  The project management platform built for architecture firms. Let&apos;s get your workspace set up in just a few steps.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4 pt-4 max-w-sm mx-auto">
                <div className="flex flex-col items-center gap-2 p-3 rounded-lg bg-muted/50">
                  <Building2 className="w-5 h-5 text-primary" />
                  <span className="text-xs text-muted-foreground">Set up firm</span>
                </div>
                <div className="flex flex-col items-center gap-2 p-3 rounded-lg bg-muted/50">
                  <Users className="w-5 h-5 text-primary" />
                  <span className="text-xs text-muted-foreground">Invite team</span>
                </div>
                <div className="flex flex-col items-center gap-2 p-3 rounded-lg bg-muted/50">
                  <CreditCard className="w-5 h-5 text-primary" />
                  <span className="text-xs text-muted-foreground">Choose plan</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Firm Setup */}
          {STEPS[currentStep].id === "firm" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold tracking-tight">Tell us about your firm</h2>
                <p className="text-muted-foreground">This helps us customize your workspace experience.</p>
              </div>
              <Card className="border-0 shadow-lg">
                <CardContent className="p-6 space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Firm Name</label>
                    <Input
                      placeholder="e.g. Smith & Associates Architecture"
                      value={firmName}
                      onChange={(e) => setFirmName(e.target.value)}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Firm Size</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {FIRM_SIZES.map((size) => (
                        <button
                          key={size.value}
                          type="button"
                          onClick={() => setFirmSize(size.value)}
                          className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                            firmSize === size.value
                              ? "border-primary bg-primary/5 text-primary ring-1 ring-primary/20"
                              : "border-border hover:border-primary/40 hover:bg-muted/50"
                          }`}
                        >
                          {size.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 3: Invite Team */}
          {STEPS[currentStep].id === "team" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold tracking-tight">Invite your team</h2>
                <p className="text-muted-foreground">Add colleagues now or skip and invite them later from Settings.</p>
              </div>
              <Card className="border-0 shadow-lg">
                <CardContent className="p-6 space-y-4">
                  {teamMembers.map((member, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <Input
                          placeholder="Name"
                          value={member.name}
                          onChange={(e) => updateTeamMember(index, "name", e.target.value)}
                          className="h-10"
                        />
                        <Input
                          placeholder="Email"
                          type="email"
                          value={member.email}
                          onChange={(e) => updateTeamMember(index, "email", e.target.value)}
                          className="h-10"
                        />
                      </div>
                      {teamMembers.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeTeamMember(index)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {teamMembers.length < 10 && (
                    <Button variant="outline" size="sm" onClick={addTeamMember} className="w-full">
                      <Plus className="w-4 h-4 mr-1.5" />
                      Add another
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 4: Choose Plan */}
          {STEPS[currentStep].id === "plan" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold tracking-tight">Choose your plan</h2>
                <p className="text-muted-foreground">Start with a plan that fits your firm, or skip to explore free.</p>
              </div>
              <div className="grid gap-4">
                {PLANS.map((plan) => (
                  <Card
                    key={plan.id}
                    className={`relative cursor-pointer transition-all border-2 ${
                      selectedPlan === plan.id
                        ? "border-primary shadow-lg shadow-primary/10"
                        : "border-transparent shadow-md hover:shadow-lg hover:border-primary/20"
                    }`}
                    onClick={() => setSelectedPlan(plan.id)}
                  >
                    {plan.popular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                          Most Popular
                        </span>
                      </div>
                    )}
                    <CardContent className="p-5 flex items-center gap-4">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        selectedPlan === plan.id ? "border-primary" : "border-muted-foreground/30"
                      }`}>
                        {selectedPlan === plan.id && <div className="w-3 h-3 rounded-full bg-primary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-lg">{plan.name}</span>
                          <span className="text-2xl font-bold">{plan.price}</span>
                          <span className="text-sm text-muted-foreground">{plan.period}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{plan.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Step 5: Done */}
          {STEPS[currentStep].id === "done" && (
            <div className="text-center space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="mx-auto w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center">
                <Rocket className="w-10 h-10 text-green-600" />
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl font-bold tracking-tight">You&apos;re all set!</h1>
                <p className="text-lg text-muted-foreground max-w-md mx-auto">
                  Your workspace is ready. Start managing projects, tracking time, and collaborating with your team.
                </p>
              </div>
              {firmName && (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted text-sm font-medium">
                  <Building2 className="w-4 h-4 text-primary" />
                  {firmName}
                </div>
              )}
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8">
            <div>
              {currentStep > 0 && STEPS[currentStep].id !== "done" && (
                <Button variant="ghost" onClick={handleBack} className="gap-1.5">
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {STEPS[currentStep].id === "team" && (
                <Button variant="ghost" onClick={() => setCurrentStep((prev) => prev + 1)} className="text-muted-foreground">
                  Skip for now
                </Button>
              )}
              {STEPS[currentStep].id === "plan" && (
                <Button variant="ghost" onClick={() => setCurrentStep((prev) => prev + 1)} className="text-muted-foreground">
                  Skip — explore free
                </Button>
              )}
              <Button
                onClick={handleNext}
                disabled={!canProceed() || isSubmitting}
                className="gap-1.5 min-w-[120px]"
                size="lg"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : STEPS[currentStep].id === "done" ? (
                  <>
                    Go to Dashboard
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
