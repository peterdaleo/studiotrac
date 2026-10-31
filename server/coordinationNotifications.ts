export type CoordinationAudience = "client" | "collaborator" | "team";

export type CoordinationNoticeSheet = {
  projectId: number;
  projectName: string;
  clientToken: string | null;
  collaboratorToken: string | null;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

/** Builds a notification for exactly one audience; never mixes capability links. */
export function createCoordinationNotice(
  sheet: CoordinationNoticeSheet,
  audience: CoordinationAudience,
  baseUrl: string,
) {
  let viewPath: string;
  if (audience === "team") {
    viewPath = `/projects/${sheet.projectId}`;
  } else {
    const token = audience === "client" ? sheet.clientToken : sheet.collaboratorToken;
    if (!token) return null;
    viewPath = `/coordination/${audience === "client" ? "client" : "collaborator"}/${encodeURIComponent(token)}`;
  }

  const viewUrl = `${new URL(baseUrl).origin}${viewPath}`;
  const projectName = sheet.projectName.replace(/[\r\n]/g, " ");
  const label = { client: "Client", collaborator: "External collaborator", team: "Firm team" }[audience];
  const viewLabel = {
    client: "View client-visible coordination items",
    collaborator: "View collaborator-visible coordination items",
    team: "Sign in to view the team project",
  }[audience];
  const detail = {
    client: "The client-visible coordination sheet has been updated.",
    collaborator: "The coordination sheet has been updated. This no-login shared view includes only items marked visible to collaborators.",
    team: "The team coordination sheet has been updated. Sign in to the project to review it.",
  }[audience];
  const smsViewLabel = {
    client: "Client-visible view",
    collaborator: "Collaborator-visible view (no login)",
    team: "Team project (sign-in required)",
  }[audience];

  return {
    subject: `[${projectName}] ${label} coordination update`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
      <h2>${escapeHtml(projectName)}</h2>
      <p><strong>${escapeHtml(label)} coordination update</strong></p>
      <p>${escapeHtml(detail)}</p>
      <p><a href="${escapeHtml(viewUrl)}">${escapeHtml(viewLabel)}</a></p>
      <p>This notification was sent automatically by StudioTrac.</p>
    </div>`,
    smsBody: `[StudioTrac] ${label} coordination update for ${projectName}. ${smsViewLabel}: ${viewUrl}`,
  };
}
