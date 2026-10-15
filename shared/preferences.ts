import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const PreferencesSchema = z.object({
  showComposerPill: z.boolean().default(true),
  refreshIntervalMinutes: z.number().int().min(1).max(60).default(10),
});

export type LarkSubPreferences = z.infer<typeof PreferencesSchema>;
export type LarkPreferences = LarkSubPreferences;

export const DEFAULT_PREFERENCES: LarkSubPreferences = {
  showComposerPill: true,
  refreshIntervalMinutes: 10,
};

export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 1,
  schema: PreferencesSchema,
});
