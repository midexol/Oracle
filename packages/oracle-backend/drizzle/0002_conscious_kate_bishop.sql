CREATE TYPE "public"."outcome_token" AS ENUM('YES', 'NO');--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "up_outcome" "outcome_token" DEFAULT 'YES' NOT NULL;