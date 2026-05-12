import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

const dbUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!dbUrl) {
  throw new Error("TURSO_DATABASE_URL environment variable is missing.");
}

if (!authToken) {
  throw new Error("TURSO_AUTH_TOKEN environment variable is missing.");
}

const client = createClient({
  url: dbUrl,
  authToken: authToken,
});

export const db = drizzle(client);
