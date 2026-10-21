import React, { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function ConvertedProspectsSection({ count, hasActiveFilters, children }: {
  count: number;
  hasActiveFilters: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const open = hasActiveFilters || expanded;

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        <h2>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl p-4 text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-expanded={open}
            aria-controls="converted-prospects"
            onClick={() => setExpanded(!expanded)}
            disabled={hasActiveFilters}
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            Converted to projects <Badge variant="secondary">{count}</Badge>
          </button>
        </h2>
        {hasActiveFilters && <p className="px-4 pb-3 text-sm text-muted-foreground">Matching converted prospects stay visible while search or filters are active.</p>}
        <div id="converted-prospects" hidden={!open}>
          {count ? children : <p className="px-4 pb-4 text-sm text-muted-foreground">No converted prospects{hasActiveFilters ? " match these filters" : " yet"}.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
