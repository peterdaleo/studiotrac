/**
 * Coordination Sheet Notification Cron Job
 *
 * Runs every 30 minutes to catch any unnotified coordination sheet items
 * that were missed by the on-post trigger (e.g. items posted within the
 * 30-minute throttle window that never got a follow-up trigger).
 */
import cron from "node-cron";
import * as db from "./db";

const THIRTY_MINUTES = 30 * 60 * 1000;

async function runCoordinationDigest() {
  try {
    const { Resend } = await import("resend");
    const apiKey = process.env.RESEND_API_KEY;

    // Twilio SMS client (lazy init)
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
    let twilioClient: import("twilio").Twilio | null = null;
    if (twilioSid && twilioAuth) {
      const { default: twilio } = await import("twilio");
      twilioClient = twilio(twilioSid, twilioAuth);
    }

    if (!apiKey && !twilioClient) return;

    // Find all active sheets that have unnotified items
    const sheetsWithPending = await db.listSheetsWithUnnotifiedItems();
    if (sheetsWithPending.length === 0) return;

    console.log(`[CoordinationCron] Found ${sheetsWithPending.length} sheet(s) with pending notifications`);

    const resend = apiKey ? new Resend(apiKey) : null;
    const baseUrl = process.env.APP_URL || "https://app.studiotrac.app";

    for (const sheet of sheetsWithPending) {
      const subscribers = await db.listCoordinationSubscribers(sheet.id);
      if (subscribers.length === 0) continue;

      const now = new Date();
      const eligibleSubscribers = subscribers.filter(sub => {
        if (!sub.lastNotifiedAt) return true;
        return (now.getTime() - new Date(sub.lastNotifiedAt).getTime()) > THIRTY_MINUTES;
      });
      if (eligibleSubscribers.length === 0) continue;

      const unnotifiedItems = await db.listUnnotifiedCoordinationItems(sheet.id);
      if (unnotifiedItems.length === 0) continue;

      const sheetUrl = `${baseUrl}/coordination/${sheet.token}`;
      const subject = unnotifiedItems.length === 1
        ? `[${sheet.projectName}] New coordination item from ${unnotifiedItems[0].authorName}`
        : `[${sheet.projectName}] ${unnotifiedItems.length} new coordination updates`;
      const smsBody = `[StudioTrac] New updates on ${sheet.projectName} coordination sheet. View: ${sheetUrl}`;

      const itemsHtml = unnotifiedItems.map(item => `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
          <p style="margin: 0 0 4px; font-size: 14px; font-weight: 600; color: #0f172a;">
            ${item.authorName}
            <span style="font-weight: 400; color: #64748b;">(${item.authorType.replace(/_/g, " ")})</span>
            ${item.isUrgent ? '<span style="margin-left: 8px; color: #b45309; font-size: 11px; background: #fef3c7; padding: 2px 6px; border-radius: 4px;">URGENT</span>' : ''}
          </p>
          <p style="margin: 0; font-size: 14px; color: #334155; white-space: pre-wrap;">${item.content.length > 300 ? item.content.slice(0, 300) + "..." : item.content}</p>
        </div>
      `).join("");

      const html = `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
            <p style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b;">Coordination Sheet Update</p>
            <h2 style="margin: 0 0 16px; font-size: 18px; color: #0f172a;">${sheet.projectName}</h2>
            ${itemsHtml}
            <div style="margin-top: 24px;">
              <a href="${sheetUrl}" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #ffffff; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">View Full Coordination Sheet</a>
            </div>
            <p style="margin: 24px 0 0; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px;">
              You're receiving this because you subscribed to updates for this coordination sheet.
              Notifications are batched and sent at most once every 30 minutes.
            </p>
          </div>
        </div>
      `;

      let anySent = false;
      for (const sub of eligibleSubscribers) {
        let subSent = false;

        // Email
        if (sub.email && resend) {
          try {
            const result = await resend.emails.send({
              from: "studioTrac <notifications@studiotrac.app>",
              to: sub.email,
              subject,
              html,
            });
            if (result.error) {
              console.error(`[CoordinationCron] Resend error for ${sub.email}:`, JSON.stringify(result.error));
            } else {
              console.log(`[CoordinationCron] Email sent to ${sub.email} for sheet "${sheet.projectName}", id: ${result.data?.id}`);
              subSent = true;
            }
          } catch (e) {
            console.error(`[CoordinationCron] Exception sending email to ${sub.email}:`, e);
          }
        }

        // SMS
        if (sub.phone && twilioClient && twilioFrom) {
          try {
            const msg = await twilioClient.messages.create({
              body: smsBody,
              from: twilioFrom,
              to: sub.phone,
            });
            console.log(`[CoordinationCron] SMS sent to ${sub.phone} for sheet "${sheet.projectName}", sid: ${msg.sid}`);
            subSent = true;
          } catch (e) {
            console.error(`[CoordinationCron] Exception sending SMS to ${sub.phone}:`, e);
          }
        }

        if (subSent) {
          await db.updateSubscriberLastNotified(sub.id);
          anySent = true;
        }
      }

      if (anySent) {
        await db.markCoordinationItemsAsNotified(unnotifiedItems.map(i => i.id));
      }
    }
  } catch (e) {
    console.error("[CoordinationCron] Unexpected error:", e);
  }
}

export function startCoordinationCron() {
  // Run every 30 minutes: at minute 0 and 30 of every hour
  cron.schedule("*/30 * * * *", () => {
    console.log("[CoordinationCron] Running digest check...");
    runCoordinationDigest();
  });
  console.log("[CoordinationCron] Scheduled — runs every 30 minutes");
}
