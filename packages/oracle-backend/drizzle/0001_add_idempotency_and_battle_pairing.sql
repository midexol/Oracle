ALTER TABLE "trades" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "battles_pair_key" ON "battles" USING btree ("prediction_a_id","prediction_b_id");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_idempotency_key_unique" UNIQUE("idempotency_key");--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_distinct_sides" CHECK ("battles"."prediction_a_id" <> "battles"."prediction_b_id");