import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getLocalUploadUrl } from "./_core/protectedUploadRoute";

// Upload integration coverage must never touch S3 or a local uploads directory.
vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ url: `/uploads/${key}` })),
}));

const enabled = process.env.LEGACY_COMPATIBILITY_INTEGRATION === "1";
const databaseUrl = process.env.DATABASE_URL;

/** Refuse every target other than the coordinator's dedicated local fixture DB. */
function assertSafeDatabaseTarget(): URL {
  if (!databaseUrl)
    throw new Error(
      "DATABASE_URL is required for legacy compatibility integration tests"
    );
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid mysql:// URL");
  }
  const hostname = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      `Refusing legacy compatibility tests against non-local database host: ${hostname}`
    );
  }
  if (database !== "stage1_legacy_test" && database !== "stage2_access_test") {
    throw new Error(
      `Refusing legacy compatibility tests against database ${database}; expected an approved localhost synthetic schema`
    );
  }
  if (url.protocol !== "mysql:" && url.protocol !== "mariadb:") {
    throw new Error(
      `Refusing legacy compatibility tests with unsupported database protocol: ${url.protocol}`
    );
  }
  return url;
}

if (enabled) assertSafeDatabaseTarget();

const suite = enabled ? describe : describe.skip;
type DbConnection = {
  execute: (sql: string, values?: unknown[]) => Promise<[any, any]>;
  end: () => Promise<void>;
};
type Actor = {
  id: number;
  role: "admin";
  organizationId: number;
  orgRole: "admin";
  isSuperAdmin: false;
  name: string;
  email: string;
  openId: string;
};

suite("legacy ORM compatibility — isolated MariaDB integration", () => {
  let connection: DbConnection;
  let appRouter: any;
  let databaseHelpers: any;
  let applicationDb: any;
  let marker: string;
  let orgA: { id: number; admin: Actor; projectId: number; shareToken: string };
  let orgB: { id: number; admin: Actor; projectId: number };
  const createdOrgIds: number[] = [];
  const createdUserIds: number[] = [];
  const createdProjectIds: number[] = [];

  const insert = async (
    table: string,
    record: Record<string, unknown>
  ): Promise<number> => {
    const columns = Object.keys(record);
    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map(key => record[key]);
    const [result] = await connection.execute(
      `INSERT INTO \`${table}\` (${columns.map(column => `\`${column}\``).join(", ")}) VALUES (${placeholders})`,
      values
    );
    return Number(result.insertId);
  };

  const actorCaller = (user: Actor) =>
    appRouter.createCaller({
      user,
      organizationId: user.organizationId,
      req: {} as any,
      res: {} as any,
    });
  const publicCaller = () =>
    appRouter.createCaller({
      user: null,
      organizationId: null,
      req: {} as any,
      res: {} as any,
    });

  const makeOrganization = async (suffix: "a" | "b") => {
    const id = await insert("organizations", {
      name: `Legacy compatibility ${suffix} ${marker}`,
      slug: `legacy-compat-${suffix}-${marker}`,
    });
    createdOrgIds.push(id);
    const name = `Legacy ${suffix} Admin ${marker}`;
    const email = `legacy-${suffix}-${marker}@example.invalid`;
    const openId = `legacy-${suffix}-${marker}`;
    const userId = await insert("users", {
      openId,
      name,
      email,
      passwordHash: "synthetic-hash",
      loginMethod: "email",
      role: "admin",
      organizationId: id,
      orgRole: "admin",
      isSuperAdmin: 0,
    });
    createdUserIds.push(userId);
    const admin: Actor = {
      id: userId,
      role: "admin",
      organizationId: id,
      orgRole: "admin",
      isSuperAdmin: false,
      name,
      email,
      openId,
    };
    const projectId = await insert("projects", {
      organizationId: id,
      name: `Legacy project ${suffix} ${marker}`,
      clientName: `Legacy client ${suffix} ${marker}`,
      status: "on_track",
      phase: "pre_design",
      completionPercentage: 0,
      billing25: 0,
      billing50: 0,
      billing75: 0,
      billing100: 0,
      billingOk: 0,
      estimatedHours: 0,
      contractedFee: 0,
      invoicedAmount: 0,
      billingType: "fixed_fee",
      hourlyRateCents: 0,
      notToExceedCents: 0,
      revenueTargetCents: 0,
    });
    createdProjectIds.push(projectId);
    return { id, admin, projectId };
  };

  const insertFile = (
    projectId: number,
    organizationId: number | null,
    fileName: string,
    url: string,
    category: string,
    isClientVisible?: boolean
  ) => {
    const record: Record<string, unknown> = {
      organizationId,
      projectId,
      uploadedById: orgA.admin.id,
      fileName,
      fileUrl: url,
      category,
    };
    if (isClientVisible !== undefined) record.isClientVisible = isClientVisible;
    return insert("project_files", record);
  };

  beforeAll(async () => {
    assertSafeDatabaseTarget();
    marker = randomUUID().replaceAll("-", "");
    const mysql = await import("mysql2/promise");
    connection = (await mysql.createConnection(
      databaseUrl!
    )) as unknown as DbConnection;
    const [{ appRouter: router }, dbModule] = await Promise.all([
      import("./routers"),
      import("./db"),
    ]);
    appRouter = router;
    databaseHelpers = dbModule;
    applicationDb = await dbModule.getDb();
    if (!applicationDb)
      throw new Error(
        "Application DB pool did not connect to an approved localhost synthetic schema"
      );

    const a = await makeOrganization("a");
    const b = await makeOrganization("b");
    const shareToken = `legacy-share-${marker}`;
    await insert("client_share_tokens", {
      organizationId: a.id,
      projectId: a.projectId,
      token: shareToken,
      label: "Synthetic legacy integration token",
      createdById: a.admin.id,
    });
    orgA = { ...a, shareToken };
    orgB = b;
  }, 30_000);

  afterAll(async () => {
    if (!connection) return;
    const deleteIn = async (
      table: string,
      column: string,
      values: number[]
    ) => {
      if (!values.length) return;
      const placeholders = values.map(() => "?").join(", ");
      await connection.execute(
        `DELETE FROM \`${table}\` WHERE \`${column}\` IN (${placeholders})`,
        values
      );
    };
    // Every deletion is scoped to generated fixture IDs; no existing rows or files are touched.
    if (createdOrgIds.length)
      await deleteIn("client_share_tokens", "organizationId", createdOrgIds);
    if (createdProjectIds.length)
      await deleteIn("project_files", "projectId", createdProjectIds);
    if (createdUserIds.length)
      await deleteIn("email_preferences", "userId", createdUserIds);
    await deleteIn("projects", "id", createdProjectIds);
    await deleteIn("users", "id", createdUserIds);
    await deleteIn("organizations", "id", createdOrgIds);
    await connection.end();
  }, 30_000);

  it("maps legacy physical columns through the ORM and retains the revised defaults/enums", async () => {
    const [projectColumns] = await connection.execute(
      "SELECT COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_files'"
    );
    const projectByName = new Map(
      (projectColumns as any[]).map(column => [column.COLUMN_NAME, column])
    );
    expect(projectByName.has("fileUrl")).toBe(true);
    expect(projectByName.has("url")).toBe(false);
    expect(projectByName.has("fileKey")).toBe(false);
    expect(projectByName.get("organizationId")?.IS_NULLABLE).toBe("YES");
    expect(
      String(projectByName.get("isClientVisible")?.COLUMN_DEFAULT)
    ).toMatch(/^(0|false)$/i);
    const fileCategoryType = String(projectByName.get("category")?.COLUMN_TYPE);
    for (const category of ["document", "drawing", "image", "other"])
      expect(fileCategoryType).toContain(category);

    const [preferenceColumns] = await connection.execute(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_preferences'"
    );
    const preferenceNames = new Set(
      (preferenceColumns as any[]).map(column => column.COLUMN_NAME)
    );
    expect(preferenceNames.has("taskOverdueAlerts")).toBe(true);
    expect(preferenceNames.has("weeklyDigest")).toBe(true);
    expect(preferenceNames.has("emailAddress")).toBe(false);
    expect(preferenceNames.has("overdueAlerts")).toBe(false);

    // This real Drizzle read exercises JS `url` mapped onto physical `fileUrl`.
    const [physicalProbe] = await connection.execute(
      "SELECT id FROM project_files WHERE projectId = ? LIMIT 1",
      [orgA.projectId]
    );
    expect(physicalProbe).toEqual([]);
    const ormRows = await databaseHelpers.listProjectFiles(orgA.projectId, orgA.id);
    expect(ormRows).toEqual([]);
  });

  it("persists email preferences without emailAddress while preserving legacy physical fields", async () => {
    const caller = actorCaller(orgA.admin);
    // Existing legacy values are synthetic seeds, not a newly exposed API setting.
    await insert("email_preferences", { userId: orgA.admin.id, taskOverdueAlerts: 1, weeklyDigest: 1 });
    await expect(
      caller.emailPreferences.upsert({
        overdueAlerts: false,
      })
    ).resolves.toBeTruthy();
    await expect(caller.emailPreferences.upsert({ weeklyDigest: false } as any)).rejects.toBeTruthy();
    await expect(
      caller.emailPreferences.upsert({
        emailAddress: "must-not-be-stored@example.invalid",
        overdueAlerts: true,
      } as any)
    ).rejects.toBeTruthy();

    const [rows] = await connection.execute(
      "SELECT taskOverdueAlerts, weeklyDigest FROM email_preferences WHERE userId = ? LIMIT 1",
      [orgA.admin.id]
    );
    expect(rows).toHaveLength(1);
    expect(Boolean((rows as any[])[0].taskOverdueAlerts)).toBe(false);
    expect(Boolean((rows as any[])[0].weeklyDigest)).toBe(true);
    const apiValue = await caller.emailPreferences.get();
    expect(apiValue).toMatchObject({
      overdueAlerts: false,
      weeklyDigest: true,
    });
    expect(apiValue).not.toHaveProperty("emailAddress");
  });

  it("inserts preferences using legacy columns and leaves digest at its existing schema default", async () => {
    await actorCaller(orgB.admin).emailPreferences.upsert({ overdueAlerts: true, deadlineAlerts: false });
    const [rows] = await connection.execute(
      "SELECT taskOverdueAlerts, deadlineAlerts, weeklyDigest FROM email_preferences WHERE userId = ?",
      [orgB.admin.id]
    );
    expect(rows).toHaveLength(1);
    expect(Boolean(rows[0].taskOverdueAlerts)).toBe(true);
    expect(Boolean(rows[0].deadlineAlerts)).toBe(false);
    expect(Boolean(rows[0].weeklyDigest)).toBe(false);
  });

  it("accepts the legacy document upload category and scopes list and public portal files", async () => {
    const key = `projects/${orgA.projectId}/files/${marker}.pdf`;
    const canonicalMatchedUrl = getLocalUploadUrl(key)!;
    const canonicalNullUrl = getLocalUploadUrl(
      `projects/${orgA.projectId}/files/${marker}-null.pdf`
    )!;
    const matchingId = await insertFile(
      orgA.projectId,
      orgA.id,
      `matched-${marker}.pdf`,
      canonicalMatchedUrl,
      "document",
      true
    );
    const nullStampId = await insertFile(
      orgA.projectId,
      null,
      `legacy-null-${marker}.pdf`,
      canonicalNullUrl,
      "drawing",
      true
    );
    const privateId = await insertFile(
      orgA.projectId,
      orgA.id,
      `private-${marker}.pdf`,
      getLocalUploadUrl(
        `projects/${orgA.projectId}/files/${marker}-private.pdf`
      )!,
      "image",
      false
    );
    const contradictoryId = await insertFile(
      orgA.projectId,
      orgB.id,
      `cross-stamped-${marker}.pdf`,
      getLocalUploadUrl(
        `projects/${orgA.projectId}/files/${marker}-cross.pdf`
      )!,
      "other",
      true
    );
    const externalUrlId = await insertFile(
      orgA.projectId,
      orgA.id,
      `external-${marker}.pdf`,
      `https://files.example.invalid/${marker}.pdf`,
      "other",
      true
    );
    const unknownPathId = await insertFile(
      orgA.projectId,
      orgA.id,
      `unknown-path-${marker}.pdf`,
      `/legacy/${marker}.pdf`,
      "other",
      true
    );
    const defaultVisibilityId = await insert("project_files", {
      organizationId: orgA.id,
      projectId: orgA.projectId,
      uploadedById: orgA.admin.id,
      fileName: `default-private-${marker}.pdf`,
      fileUrl: getLocalUploadUrl(
        `projects/${orgA.projectId}/files/${marker}-default.pdf`
      ),
      category: "other",
    });
    const foreignProjectFileId = await insertFile(
      orgB.projectId,
      orgB.id,
      `foreign-project-${marker}.pdf`,
      getLocalUploadUrl(
        `projects/${orgB.projectId}/files/${marker}-foreign.pdf`
      )!,
      "document",
      true
    );

    const caller = actorCaller(orgA.admin);
    const listed = await caller.files.list({ projectId: orgA.projectId });
    const listedIds = new Set(listed.map((file: any) => Number(file.id)));
    for (const id of [
      matchingId,
      nullStampId,
      privateId,
      defaultVisibilityId,
    ])
      expect(listedIds.has(id)).toBe(true);
    expect(listedIds.has(contradictoryId)).toBe(false);
    expect(listedIds.has(externalUrlId)).toBe(false);
    expect(listedIds.has(unknownPathId)).toBe(false);
    for (const file of listed) {
      expect(file).toHaveProperty("url");
      expect(file).not.toHaveProperty("fileKey");
    }
    await expect(
      caller.files.list({ projectId: orgB.projectId })
    ).rejects.toBeTruthy();

    // The default remains private for old callers that omit isClientVisible.
    const [defaultRows] = await connection.execute(
      "SELECT isClientVisible FROM project_files WHERE id = ?",
      [defaultVisibilityId]
    );
    expect(Boolean((defaultRows as any[])[0]?.isClientVisible)).toBe(false);

    // No external storage/network is used: storagePut is mocked and the legacy category is still validated and stored.
    const uploadResult = await caller.files.upload({
      projectId: orgA.projectId,
      fileName: `route-upload-${marker}.pdf`,
      fileData: Buffer.from("synthetic test bytes").toString("base64"),
      mimeType: "application/pdf",
      category: "document",
    });
    const uploadId = Number(uploadResult.id);
    const [uploadedRows] = await connection.execute(
      "SELECT fileUrl, category FROM project_files WHERE id = ?",
      [uploadId]
    );
    expect(uploadedRows).toHaveLength(1);
    expect((uploadedRows as any[])[0].fileUrl).toMatch(
      /^\/uploads\/projects\//
    );
    expect((uploadedRows as any[])[0].category).toBe("document");

    await expect(caller.files.upload({
      projectId: orgA.projectId, fileName: "unsupported.pdf", fileData: "dGVzdA==", category: "photo",
    })).rejects.toBeTruthy();
    await expect(actorCaller(orgB.admin).files.delete({ id: matchingId })).rejects.toBeTruthy();
    const [preserved] = await connection.execute("SELECT COUNT(*) AS n FROM project_files WHERE id = ?", [matchingId]);
    expect(Number(preserved[0].n)).toBe(1);
    const finalListed = await caller.files.list({ projectId: orgA.projectId });
    expect(await caller.files.count({ projectId: orgA.projectId })).toBe(finalListed.length);

    const publicData = await publicCaller().portal.getProject({
      token: orgA.shareToken,
    });
    expect(publicData.error).toBeNull();
    const publicFiles = publicData.data.files as any[];
    const publicIds = new Set(publicFiles.map(file => Number(file.id)));
    expect(publicIds).toEqual(new Set([matchingId, nullStampId]));
    for (const id of [
      privateId,
      contradictoryId,
      externalUrlId,
      unknownPathId,
      defaultVisibilityId,
      foreignProjectFileId,
    ]) {
      expect(publicIds.has(id)).toBe(false);
    }
    for (const file of publicFiles) {
      expect(file.url).toMatch(/^\/uploads\//);
      expect(file).not.toHaveProperty("fileKey");
    }
  });
});
