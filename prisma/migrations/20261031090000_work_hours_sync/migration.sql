-- Hourly syncs on weekdays, 7 AM–7 PM in the CEO's timezone. The new value is
-- used in the next migration: Postgres can't use an enum value in the same
-- transaction that adds it.
ALTER TYPE "SyncFrequency" ADD VALUE 'WORK_HOURS' BEFORE 'HOURLY';
