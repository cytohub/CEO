"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, SimpleSelect } from "@/components/common/fields";
import { useAction } from "@/components/common/use-action";
import { formatDayFull } from "@/lib/dates";
import { updateProfile } from "@/server/actions/settings";
import type { TimezoneOption } from "@/server/queries/settings";
import { SectionFooter } from "./section";

export function ProfileForm({
  profile,
  timezones,
}: {
  profile: { name: string; title: string; timezone: string; email: string; today: Date };
  timezones: TimezoneOption[];
}) {
  const [name, setName] = useState(profile.name);
  const [title, setTitle] = useState(profile.title);
  const [timezone, setTimezone] = useState(profile.timezone);
  const { pending, run } = useAction();
  const dirty = name !== profile.name || title !== profile.title || timezone !== profile.timezone;

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateProfile({ name, title, timezone }));
      }}
    >
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="profile-name" hint="Shown in the greeting and on your person record.">
          <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} required />
        </Field>
        <Field label="Title" htmlFor="profile-title">
          <Input id="profile-title" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="organization-title" maxLength={120} required />
        </Field>
        <Field label="Timezone" htmlFor="profile-timezone" hint="Drives “today”: due dates, the daily brief, Top 5 and end-of-day roll over at midnight in this zone.">
          <SimpleSelect
            id="profile-timezone"
            value={timezone}
            onChange={(v) => v && setTimezone(v)}
            options={timezones.map((t) => ({ value: t.value, label: t.label, group: t.region }))}
          />
        </Field>
        <Field label="Sign-in email" htmlFor="profile-email" hint="Managed by your identity provider.">
          <Input id="profile-email" value={profile.email} readOnly disabled />
        </Field>
      </div>
      <SectionFooter
        hint={
          <>
            Today is <span className="font-medium text-ink-2">{formatDayFull(profile.today)}</span> in {profile.timezone.replace(/_/g, " ")}
          </>
        }
      >
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setName(profile.name);
              setTitle(profile.title);
              setTimezone(profile.timezone);
            }}
          >
            Discard
          </Button>
        )}
        <Button type="submit" size="sm" disabled={pending || !dirty || !name.trim() || !title.trim()}>
          {pending && <Loader2 className="animate-spin" />}
          Save profile
        </Button>
      </SectionFooter>
    </form>
  );
}
