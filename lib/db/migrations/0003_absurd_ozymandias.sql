ALTER TABLE "imports" ADD COLUMN "conflicts_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "unmatched_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "surfaced" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "platforms" text[];