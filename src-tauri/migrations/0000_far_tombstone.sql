CREATE TABLE `civ_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`civ_slug` text NOT NULL,
	`body_md` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `civ_notes_user_civ_uq` ON `civ_notes` (`user_id`,`civ_slug`);--> statement-breakpoint
CREATE TABLE `civ_slug_aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`civ_slug` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `civilizations` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_slug` text,
	`is_variant` integer DEFAULT false NOT NULL,
	`flag_image_url` text,
	`data_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`game_id` integer NOT NULL,
	`body_md` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_notes_user_game_uq` ON `game_notes` (`user_id`,`game_id`);--> statement-breakpoint
CREATE TABLE `game_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`team` integer NOT NULL,
	`is_self` integer NOT NULL,
	`profile_id` integer,
	`name` text NOT NULL,
	`civ_slug` text NOT NULL,
	`civ_randomized` integer,
	`result` text NOT NULL,
	`rating` integer,
	`rating_diff` integer,
	`mmr` integer,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participants_game_idx` ON `game_participants` (`game_id`);--> statement-breakpoint
CREATE INDEX `participants_civ_idx` ON `game_participants` (`civ_slug`);--> statement-breakpoint
CREATE INDEX `participants_profile_idx` ON `game_participants` (`profile_id`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source` text NOT NULL,
	`aoe4world_game_id` integer,
	`started_at` integer NOT NULL,
	`duration_seconds` integer,
	`map_slug` text,
	`kind` text NOT NULL,
	`leaderboard` text,
	`patch` integer,
	`server` text,
	`my_team` integer,
	`my_civ_slug` text NOT NULL,
	`my_civ_randomized` integer,
	`my_result` text NOT NULL,
	`my_rating` integer,
	`my_rating_diff` integer,
	`my_mmr` integer,
	`raw_payload_json` text,
	`imported_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_aoe4world_uq` ON `games` (`user_id`,`aoe4world_game_id`) WHERE "games"."aoe4world_game_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `games_user_started_idx` ON `games` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `games_user_civ_idx` ON `games` (`user_id`,`my_civ_slug`);--> statement-breakpoint
CREATE INDEX `games_user_map_idx` ON `games` (`user_id`,`map_slug`);--> statement-breakpoint
CREATE TABLE `map_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`map_slug` text NOT NULL,
	`body_md` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_notes_user_map_uq` ON `map_notes` (`user_id`,`map_slug`);--> statement-breakpoint
CREATE TABLE `maps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maps_slug_uq` ON `maps` (`slug`);--> statement-breakpoint
CREATE TABLE `matchup_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`my_civ_slug` text NOT NULL,
	`opp_civ_slug` text NOT NULL,
	`body_md` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matchup_notes_pair_uq` ON `matchup_notes` (`user_id`,`my_civ_slug`,`opp_civ_slug`);--> statement-breakpoint
CREATE INDEX `matchup_notes_user_mycivc_idx` ON `matchup_notes` (`user_id`,`my_civ_slug`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`user_id` integer NOT NULL,
	`leaderboard` text NOT NULL,
	`last_seen_game_id` integer,
	`last_polled_at` integer,
	`last_success_at` integer,
	`last_error` text,
	PRIMARY KEY(`user_id`, `leaderboard`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`aoe4world_profile_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_slug_uq` ON `users` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_profile_id_uq` ON `users` (`aoe4world_profile_id`);