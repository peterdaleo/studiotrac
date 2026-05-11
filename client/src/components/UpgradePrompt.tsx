import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { useLocation } from "wouter";

interface UpgradePromptProps {
  feature: string;
  requiredPlan?: string;
}

export function UpgradePrompt({ feature, requiredPlan = "Professional" }: UpgradePromptProps) {
  const [, setLocation] = useLocation();

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">{feature}</h3>
        <p className="text-muted-foreground mb-4 max-w-sm">
          This feature requires the {requiredPlan} plan or higher. Upgrade your subscription to unlock it.
        </p>
        <Button onClick={() => setLocation("/billing")}>
          View Plans
        </Button>
      </CardContent>
    </Card>
  );
}
