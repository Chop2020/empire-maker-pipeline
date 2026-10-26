import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { IngestReport, License, ProductDocument, PublisherBrand } from '../../shared/types.js';

export const publishers = pgTable('publishers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  brand: jsonb('brand').$type<PublisherBrand>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const authors = pgTable('authors', {
  id: text('id').primaryKey(),
  publisherId: text('publisher_id').notNull(),
  penName: text('pen_name').notNull(),
  shortBio: text('short_bio'),
  bio: text('bio'),
  personaId: text('persona_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  publisherId: text('publisher_id').notNull(),
  authorId: text('author_id'),
  title: text('title').notNull(),
  productType: text('product_type').notNull().default('ebook'),
  status: text('status').notNull().default('ingesting'),
  sourceFileName: text('source_file_name').notNull(),
  sourceFileKey: text('source_file_key').notNull(),
  document: jsonb('document').$type<ProductDocument>(),
  license: jsonb('license').$type<License>().notNull(),
  ingestReport: jsonb('ingest_report').$type<IngestReport>(),
  renderFileKey: text('render_file_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('queued'),
  progress: integer('progress').notNull().default(0),
  message: text('message').notNull().default(''),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Boot-time DDL: keeps first deploys on Replit zero-step. Swap for drizzle-kit migrations once the schema settles.
export const DDL = `
CREATE TABLE IF NOT EXISTS publishers (
  id text PRIMARY KEY,
  name text NOT NULL,
  brand jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS authors (
  id text PRIMARY KEY,
  publisher_id text NOT NULL,
  pen_name text NOT NULL,
  short_bio text,
  bio text,
  persona_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  publisher_id text NOT NULL,
  author_id text,
  title text NOT NULL,
  product_type text NOT NULL DEFAULT 'ebook',
  status text NOT NULL DEFAULT 'ingesting',
  source_file_name text NOT NULL,
  source_file_key text NOT NULL,
  document jsonb,
  license jsonb NOT NULL,
  ingest_report jsonb,
  render_file_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  product_id text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT '',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_product_idx ON jobs (product_id);
`;
