CREATE TYPE "public"."asset" AS ENUM('BTC', 'ETH', 'SOL', 'SOMI');--> statement-breakpoint
CREATE TYPE "public"."battle_status" AS ENUM('LIVE', 'SETTLED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('UP', 'DOWN');--> statement-breakpoint
CREATE TYPE "public"."duration" AS ENUM('1M', '5M', '15M', '1H', '4H', '1D');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('OPEN', 'CLOSED', 'SETTLED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."prediction_status" AS ENUM('PENDING', 'WON', 'LOST', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."trade_source" AS ENUM('BACK_PREDICTION', 'OWN_PREDICTION', 'DIRECT', 'BATTLE');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"username" text,
	"avatar_url" text,
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "market_price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"up_price_cents" integer NOT NULL,
	"down_price_cents" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dreamdex_market_id" text NOT NULL,
	"asset" "asset" NOT NULL,
	"duration" "duration" NOT NULL,
	"opening_reference" numeric(24, 8),
	"closing_reference" numeric(24, 8),
	"status" "market_status" DEFAULT 'OPEN' NOT NULL,
	"outcome" "direction",
	"up_price_cents" integer,
	"down_price_cents" integer,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_dreamdex_market_id_unique" UNIQUE("dreamdex_market_id")
);
--> statement-breakpoint
CREATE TABLE "prediction_results" (
	"prediction_id" uuid PRIMARY KEY NOT NULL,
	"result" "prediction_status" NOT NULL,
	"market_outcome" "direction",
	"entry_price_cents" integer NOT NULL,
	"settlement_price_cents" integer,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"entry_price_cents" integer NOT NULL,
	"stake" numeric(20, 6),
	"rationale" text,
	"status" "prediction_status" DEFAULT 'PENDING' NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"backed_prediction_id" uuid,
	"backed_user_id" uuid,
	"source" "trade_source" DEFAULT 'DIRECT' NOT NULL,
	"side" "direction" NOT NULL,
	"price_cents" integer NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"filled_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"status" "trade_status" DEFAULT 'PENDING' NOT NULL,
	"dreamdex_order_id" text,
	"tx_hash" text,
	"realized_pnl" numeric(20, 6),
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_dreamdex_order_id_unique" UNIQUE("dreamdex_order_id")
);
--> statement-breakpoint
CREATE TABLE "battles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"prediction_a_id" uuid NOT NULL,
	"prediction_b_id" uuid NOT NULL,
	"status" "battle_status" DEFAULT 'LIVE' NOT NULL,
	"winner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"following_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_following_id_pk" PRIMARY KEY("follower_id","following_id"),
	CONSTRAINT "follows_no_self" CHECK ("follows"."follower_id" <> "follows"."following_id")
);
--> statement-breakpoint
CREATE TABLE "user_segment_stats" (
	"user_id" uuid NOT NULL,
	"asset" "asset" NOT NULL,
	"duration" "duration" NOT NULL,
	"settled_predictions" integer DEFAULT 0 NOT NULL,
	"correct_predictions" integer DEFAULT 0 NOT NULL,
	"accuracy" numeric(6, 5),
	"score" integer DEFAULT 0 NOT NULL,
	"edge" numeric(7, 6),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_segment_stats_user_id_asset_duration_pk" PRIMARY KEY("user_id","asset","duration")
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"total_predictions" integer DEFAULT 0 NOT NULL,
	"settled_predictions" integer DEFAULT 0 NOT NULL,
	"correct_predictions" integer DEFAULT 0 NOT NULL,
	"accuracy" numeric(6, 5),
	"score" integer DEFAULT 0 NOT NULL,
	"edge" numeric(7, 6),
	"roi" numeric(10, 4),
	"avg_entry_price_cents" integer,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"volume_backed" numeric(24, 6) DEFAULT '0' NOT NULL,
	"backers_count" integer DEFAULT 0 NOT NULL,
	"followers_count" integer DEFAULT 0 NOT NULL,
	"following_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_results" ADD CONSTRAINT "prediction_results_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_backed_prediction_id_predictions_id_fk" FOREIGN KEY ("backed_prediction_id") REFERENCES "public"."predictions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_backed_user_id_users_id_fk" FOREIGN KEY ("backed_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_prediction_a_id_predictions_id_fk" FOREIGN KEY ("prediction_a_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_prediction_b_id_predictions_id_fk" FOREIGN KEY ("prediction_b_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_winner_user_id_users_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_users_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_segment_stats" ADD CONSTRAINT "user_segment_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_nonces_wallet_idx" ON "auth_nonces" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_snapshots_market_time_idx" ON "market_price_snapshots" USING btree ("market_id","recorded_at");--> statement-breakpoint
CREATE INDEX "markets_status_closes_at_idx" ON "markets" USING btree ("status","closes_at");--> statement-breakpoint
CREATE INDEX "markets_asset_duration_idx" ON "markets" USING btree ("asset","duration");--> statement-breakpoint
CREATE INDEX "markets_closes_at_idx" ON "markets" USING btree ("closes_at");--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_user_market_key" ON "predictions" USING btree ("user_id","market_id");--> statement-breakpoint
CREATE INDEX "predictions_created_at_idx" ON "predictions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "predictions_user_status_idx" ON "predictions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "predictions_market_status_idx" ON "predictions" USING btree ("market_id","status");--> statement-breakpoint
CREATE INDEX "trades_user_idx" ON "trades" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "trades_market_idx" ON "trades" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "trades_backed_user_idx" ON "trades" USING btree ("backed_user_id");--> statement-breakpoint
CREATE INDEX "trades_backed_prediction_idx" ON "trades" USING btree ("backed_prediction_id");--> statement-breakpoint
CREATE INDEX "trades_status_idx" ON "trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "battles_status_idx" ON "battles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "battles_market_idx" ON "battles" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "follows_following_idx" ON "follows" USING btree ("following_id");--> statement-breakpoint
CREATE INDEX "segment_stats_leaderboard_idx" ON "user_segment_stats" USING btree ("asset","duration","score");--> statement-breakpoint
CREATE INDEX "user_stats_score_idx" ON "user_stats" USING btree ("score");--> statement-breakpoint
CREATE INDEX "user_stats_accuracy_idx" ON "user_stats" USING btree ("accuracy");