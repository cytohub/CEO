"use client";

import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/components/common/use-action";
import { setSourceEnabled } from "@/server/actions/settings";

export function SourceToggle({ sourceKey, name, enabled, alwaysOn, registered }: { sourceKey: string; name: string; enabled: boolean; alwaysOn: boolean; registered: boolean }) {
  const { pending, run } = useAction();
  if (alwaysOn || !registered) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${name}: ${alwaysOn ? "always on" : "not registered"}`}>
            <Switch size="sm" checked={alwaysOn} disabled aria-hidden tabIndex={-1} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{alwaysOn ? "The workspace graph is always analyzed" : "Run a Brain refresh to register this source"}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Switch
      size="sm"
      checked={enabled}
      disabled={pending}
      onCheckedChange={(v) => run(() => setSourceEnabled(sourceKey, v))}
      aria-label={`${enabled ? "Disable" : "Enable"} ${name}`}
    />
  );
}
