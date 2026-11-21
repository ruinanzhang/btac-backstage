import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const bands = sqliteTable("bands", {
  id: text().primaryKey().notNull(),
  ownerId: text("owner_id").notNull(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  accent: text().notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("bands_owner").on(table.ownerId)]);

export const presales = sqliteTable("presales", {
  id: text().primaryKey().notNull(),
  bandId: text("band_id").notNull().references(() => bands.id),
  slug: text().notNull(),
  title: text().notNull(),
  venue: text().notNull(),
  description: text().notNull(),
  eventAt: integer("event_at").notNull(),
  opensAt: integer("opens_at").notNull(),
  timezone: text().notNull(),
  ticketUrl: text("ticket_url").notNull(),
  createdAt: integer("created_at").notNull(),
  publishedAt: integer("published_at"),
}, (table) => [
  uniqueIndex("presales_band_slug").on(table.bandId, table.slug),
  index("presales_opening").on(table.publishedAt, table.opensAt),
]);

export const partners = sqliteTable("partners", {
  id: text().primaryKey().notNull(),
  presaleId: text("presale_id").notNull().references(() => presales.id),
  name: text().notNull(),
  code: text().notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("partners_presale_code").on(table.presaleId, table.code)]);

export const signups = sqliteTable("signups", {
  id: text().primaryKey().notNull(),
  presaleId: text("presale_id").notNull().references(() => presales.id),
  partnerId: text("partner_id").references(() => partners.id),
  email: text().notNull(),
  consentedAt: integer("consented_at").notNull(),
  updatesOptInAt: integer("updates_opt_in_at"),
  ticketToken: text("ticket_token").notNull().unique(),
  delivery: text({ enum: ["pending", "sending", "sent", "failed"] }).notNull().default("pending"),
  attempts: integer().notNull().default(0),
  nextAttemptAt: integer("next_attempt_at").notNull().default(0),
  firstAttemptAt: integer("first_attempt_at"),
  leaseId: text("lease_id"),
  sentAt: integer("sent_at"),
}, (table) => [
  uniqueIndex("signups_presale_email").on(table.presaleId, table.email),
  index("signups_presale_partner").on(table.presaleId, table.partnerId),
  index("signups_delivery").on(table.delivery, table.nextAttemptAt),
]);

export const clicks = sqliteTable("clicks", {
  id: text().primaryKey().notNull(),
  presaleId: text("presale_id").notNull().references(() => presales.id),
  partnerId: text("partner_id").references(() => partners.id),
  clickedAt: integer("clicked_at").notNull(),
}, (table) => [index("clicks_presale_partner").on(table.presaleId, table.partnerId)]);
