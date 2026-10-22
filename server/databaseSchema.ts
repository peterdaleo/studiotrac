import { is } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import type { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "../drizzle/schema";

/** A code-derived inventory of the tables and physical columns this server needs. */
function deriveRequiredSchema(): Readonly<Record<string, readonly string[]>> {
  const inventory: Record<string, readonly string[]> = {};

  for (const candidate of Object.values(schema)) {
    if (!is(candidate, MySqlTable)) continue;
    const config = getTableConfig(candidate);
    inventory[config.name] = Object.freeze(config.columns.map((column) => column.name));
  }

  return Object.freeze(
    Object.fromEntries(
      Object.entries(inventory)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([table, columns]) => [table, columns]),
    ),
  );
}

export const REQUIRED_DATABASE_SCHEMA = deriveRequiredSchema();

/** This query reads only the active database's metadata; it never touches app rows. */
const METADATA_QUERY = `
SELECT c.TABLE_NAME AS tableName, c.COLUMN_NAME AS columnName
FROM information_schema.COLUMNS AS c
INNER JOIN information_schema.TABLES AS t
  ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
  AND t.TABLE_NAME = c.TABLE_NAME
WHERE c.TABLE_SCHEMA = DATABASE()
  AND t.TABLE_TYPE = 'BASE TABLE'
`;

type MetadataRow = { tableName: string; columnName: string };
type DatabaseLike = Pick<MySql2Database<any>, "execute">;

export class DatabaseSchemaValidationError extends Error {
  readonly missingTables: readonly string[];
  readonly missingColumns: Readonly<Record<string, readonly string[]>>;

  constructor(
    message: string,
    missingTables: readonly string[] = [],
    missingColumns: Readonly<Record<string, readonly string[]>> = {},
  ) {
    super(message);
    this.name = "DatabaseSchemaValidationError";
    this.missingTables = missingTables;
    this.missingColumns = missingColumns;
  }
}

function metadataRows(result: unknown): MetadataRow[] {
  let rows = result;

  // mysql2's raw execute form is [rows, fieldPackets]; fakes and other compatible
  // adapters may return the row array directly.
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    Array.isArray(result[1]) &&
    (result[1].length === 0 || (typeof result[1][0] === "object" && result[1][0] !== null))
  ) {
    rows = result[0];
  }

  if (!Array.isArray(rows)) {
    throw new Error("Unexpected metadata result");
  }

  return rows.map((row): MetadataRow => {
    if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string") {
      return { tableName: row[0], columnName: row[1] };
    }
    if (
      typeof row === "object" && row !== null &&
      typeof (row as Record<string, unknown>).tableName === "string" &&
      typeof (row as Record<string, unknown>).columnName === "string"
    ) {
      return row as MetadataRow;
    }
    throw new Error("Unexpected metadata row");
  });
}

/**
 * Reject startup unless the active database contains every table and column
 * represented by the runtime Drizzle declarations. This performs one metadata-only
 * SELECT and deliberately does not attempt to repair or migrate the database.
 */
export async function assertDatabaseSchemaReady(db: DatabaseLike): Promise<void> {
  let rows: MetadataRow[];
  try {
    rows = metadataRows(await db.execute<MetadataRow[]>(METADATA_QUERY));
  } catch {
    // Do not expose driver errors, credentials, URLs, or SQL connection details.
    throw new DatabaseSchemaValidationError(
      "Unable to verify the required database schema using read-only metadata. Check database connectivity and permissions.",
    );
  }

  const actual = new Map<string, Set<string>>();
  for (const row of rows) {
    let columns = actual.get(row.tableName);
    if (!columns) {
      columns = new Set<string>();
      actual.set(row.tableName, columns);
    }
    columns.add(row.columnName);
  }

  const missingTables: string[] = [];
  const missingColumns: Record<string, readonly string[]> = {};
  for (const [table, requiredColumns] of Object.entries(REQUIRED_DATABASE_SCHEMA)) {
    const presentColumns = actual.get(table);
    if (!presentColumns) {
      missingTables.push(table);
      continue;
    }
    const missing = requiredColumns.filter((column) => !presentColumns.has(column));
    if (missing.length > 0) missingColumns[table] = Object.freeze(missing);
  }

  if (missingTables.length > 0 || Object.keys(missingColumns).length > 0) {
    const details: string[] = [];
    if (missingTables.length > 0) details.push(`missing tables: ${missingTables.join(", ")}`);
    for (const [table, columns] of Object.entries(missingColumns)) {
      details.push(`missing columns in ${table}: ${columns.join(", ")}`);
    }
    throw new DatabaseSchemaValidationError(
      `Database schema is not ready (${details.join("; ")}). Apply the approved schema changes before starting the application.`,
      Object.freeze(missingTables),
      Object.freeze(missingColumns),
    );
  }
}
