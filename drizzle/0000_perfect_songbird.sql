CREATE TABLE "image_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"transformations" jsonb NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"extension" varchar(10) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(50) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_variants" ADD CONSTRAINT "image_variants_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "image_variants_storage_key_unique" ON "image_variants" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "image_variants_image_created_idx" ON "image_variants" USING btree ("image_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "images_storage_key_unique" ON "images" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "images_user_created_idx" ON "images" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");