import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { schema } from "../../db/schema";

export function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }
  return neon(connectionString);
}

export function getDb() {
  return drizzle(getSql(), { schema });
}
