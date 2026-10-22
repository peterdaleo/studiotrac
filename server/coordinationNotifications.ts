type NotificationSheet = { projectId: number; projectName: string; clientToken: string | null };
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

/** Legacy subscription rows do not identify main-link versus client-link authority.
 * They may receive a generic notice, never private item text or an internal bearer token.
 * Client links remain useful; viewing internal updates requires the user's tenant login.
 */
export function createSafeCoordinationNotice(sheet: NotificationSheet, baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  const teamUrl = `${origin}/projects/${sheet.projectId}`;
  const clientUrl = sheet.clientToken ? `${origin}/coordination/client/${encodeURIComponent(sheet.clientToken)}` : null;
  const projectName = sheet.projectName.replace(/[\r\n]/g, " ");
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
    <h2>${escapeHtml(projectName)}</h2>
    <p>Your coordination sheet has been updated. Private item details are not included in notification messages.</p>
    ${clientUrl ? `<p><a href="${escapeHtml(clientUrl)}">View client-visible coordination items</a></p>` : ""}
    <p><a href="${escapeHtml(teamUrl)}">Team members: sign in to view all project updates</a></p>
    <p>Notifications are batched and sent at most once every 30 minutes.</p>
  </div>`;
  return {
    subject: `[${projectName}] Coordination sheet updated`,
    html,
    smsBody: `[StudioTrac] Coordination sheet updated. ${clientUrl ? `Client view: ${clientUrl}` : `Team sign-in: ${teamUrl}`}`,
  };
}
