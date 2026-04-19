import { Resend } from "resend";
import * as db from "../db";
import { ENV } from "./env";

type InviteRole = "user" | "admin";

type SendTeamInviteEmailParams = {
  to: string;
  inviteeName: string;
  invitedByName?: string | null;
  role: InviteRole;
  title?: string;
  signupUrl: string;
};

const FROM_EMAIL = "studioTrac <onboarding@resend.dev>";

function getRoleLabel(role: InviteRole) {
  return role === "admin" ? "Admin" : "Staff";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildInviteHtml(params: SendTeamInviteEmailParams) {
  const roleLabel = getRoleLabel(params.role);
  const greetingName = escapeHtml(params.inviteeName.trim() || "there");
  const inviter = params.invitedByName ? escapeHtml(params.invitedByName) : "your studio administrator";
  const titleText = params.title ? `\n              <p style=\"margin: 0; font-size: 14px; color: #475569;\"><strong>Title:</strong> ${escapeHtml(params.title)}</p>` : "";

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: Inter, Arial, sans-serif; color: #0f172a;">
    <div style="max-width: 640px; margin: 0 auto; padding: 32px 16px;">
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 20px; overflow: hidden; box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08);">
        <div style="padding: 32px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff;">
          <div style="display: inline-block; padding: 6px 12px; border-radius: 999px; background: rgba(255, 255, 255, 0.12); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;">studioTrac invitation</div>
          <h1 style="margin: 16px 0 0; font-size: 30px; line-height: 1.2;">You’ve been invited to join studioTrac</h1>
          <p style="margin: 12px 0 0; font-size: 16px; line-height: 1.6; color: rgba(255, 255, 255, 0.84);">Set up your account to access your studio workspace, collaborate with your team, and start managing projects.</p>
        </div>
        <div style="padding: 32px;">
          <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.7;">Hi ${greetingName},</p>
          <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.7; color: #334155;">${inviter} has invited you to join <strong>studioTrac</strong>. Your initial workspace access has been prepared with the role below.</p>
          <div style="margin: 0 0 24px; padding: 20px; border-radius: 16px; background: #f8fafc; border: 1px solid #e2e8f0;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #475569;"><strong>Assigned role:</strong> ${roleLabel}</p>${titleText}
            <p style="margin: 8px 0 0; font-size: 14px; color: #475569;">For best results, sign up with the same email address that received this invitation.</p>
          </div>
          <div style="margin: 28px 0; text-align: center;">
            <a href="${escapeHtml(params.signupUrl)}" style="display: inline-block; padding: 14px 24px; border-radius: 12px; background: #2563eb; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Create your account</a>
          </div>
          <p style="margin: 0 0 12px; font-size: 14px; line-height: 1.7; color: #64748b;">If the button does not open, copy and paste this link into your browser:</p>
          <p style="margin: 0; font-size: 14px; line-height: 1.7; word-break: break-word;"><a href="${escapeHtml(params.signupUrl)}" style="color: #2563eb; text-decoration: underline;">${escapeHtml(params.signupUrl)}</a></p>
        </div>
      </div>
      <p style="margin: 16px 8px 0; font-size: 12px; line-height: 1.6; color: #94a3b8; text-align: center;">This invitation was sent by studioTrac via Resend’s shared sending domain for initial setup.</p>
    </div>
  </body>
</html>`;
}

function buildInviteText(params: SendTeamInviteEmailParams) {
  const roleLabel = getRoleLabel(params.role);
  const inviter = params.invitedByName?.trim() || "your studio administrator";
  const titleLine = params.title ? `Title: ${params.title}\n` : "";

  return [
    `Hi ${params.inviteeName.trim() || "there"},`,
    "",
    `${inviter} has invited you to join studioTrac.`,
    `Assigned role: ${roleLabel}`,
    titleLine.trimEnd(),
    "",
    "Create your account using the same email address that received this invitation:",
    params.signupUrl,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function sendTeamInviteEmail(params: SendTeamInviteEmailParams) {
  if (!ENV.resendApiKey) {
    console.warn("[Invite] RESEND_API_KEY is not set; skipping invite email delivery.");
    return { sent: false as const, reason: "missing_api_key" as const };
  }

  const resend = new Resend(ENV.resendApiKey);
  const roleLabel = getRoleLabel(params.role);
  const subject = `You’ve been invited to join studioTrac as ${roleLabel}`;
  const text = buildInviteText(params);
  const html = buildInviteHtml(params);

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: [params.to],
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(error.message || "Failed to send invite email via Resend");
  }

  await db.logEmail({
    recipientEmail: params.to,
    subject,
    body: text,
  });

  return {
    sent: true as const,
    id: data?.id ?? null,
  };
}
