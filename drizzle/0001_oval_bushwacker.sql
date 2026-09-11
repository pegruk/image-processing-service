ALTER TABLE "images" ADD COLUMN "deletion_state" varchar(16) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "storage_used_bytes" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "users" SET "storage_used_bytes" = COALESCE((SELECT SUM("images"."size_bytes") FROM "images" WHERE "images"."user_id" = "users"."id"), 0) + COALESCE((SELECT SUM("image_variants"."size_bytes") FROM "image_variants" INNER JOIN "images" ON "images"."id" = "image_variants"."image_id" WHERE "images"."user_id" = "users"."id"), 0);
