-- New connections sync hourly in work hours, and connections on the old
-- around-the-clock default move to it. Webhook, daily and manual connections
-- keep their setting.
ALTER TABLE "SourceConnection" ALTER COLUMN "syncFrequency" SET DEFAULT 'WORK_HOURS';
UPDATE "SourceConnection" SET "syncFrequency" = 'WORK_HOURS' WHERE "syncFrequency" = 'HOURLY';
