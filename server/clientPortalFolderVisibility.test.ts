import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const projectViewSource = readFileSync(new URL("../client/src/pages/ProjectDetail.tsx", import.meta.url), "utf8");
const clientPortalSource = readFileSync(new URL("../client/src/pages/ClientPortal.tsx", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../drizzle/0018_project_client_portal_folder_visibility.sql", import.meta.url), "utf8");

describe("client portal folder visibility and wrapping", () => {
  it("gates the folder URL in both the client-wide and single-project response shapes", () => {
    const gatedUrlAssignments = dbSource.match(
      /driveFolderUrl: project(?:\[0\])?\.clientPortalFolderVisible \? project(?:\[0\])?\.driveFolderUrl : null/g,
    );
    expect(gatedUrlAssignments).toHaveLength(2);
  });

  it("provides a project-view checkbox and accepts its boolean update", () => {
    expect(projectViewSource).toContain("Show folder in Client Portal");
    expect(projectViewSource).toContain("clientPortalFolderVisible: checked === true");
    expect(routerSource).toContain("clientPortalFolderVisible: z.boolean().optional()");
  });

  it("defaults new projects to hidden and preserves visibility for existing links", () => {
    expect(migrationSource).toContain("DEFAULT false");
    expect(migrationSource).toContain("SET clientPortalFolderVisible = true");
    expect(migrationSource).toContain("driveFolderUrl IS NOT NULL AND driveFolderUrl <> ''");
  });

  it("wraps both project descriptions and client-visible updates at long URLs", () => {
    expect(clientPortalSource.match(/overflowWrap: "anywhere"/g)).toHaveLength(2);
  });
});
