import { isOrganizationWorkspaceAccessible } from "./workspaceAccess";
import { createSafeCoordinationNotice } from "./coordinationNotifications";
/**
 * Coordination Sheet Notification Cron Job
 *
 * Runs every 30 minutes to catch any unnotified coordination sheet items
 * that were missed by the on-post trigger (e.g. items posted within the
 * 30-minute throttle window that never got a follow-up trigger).
 *
 * Resend and Twilio are lazy-loaded on first use to avoid OOM on Railway startup.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import cron from "node-cron";
import * as db from "./db";

const THIRTY_MINUTES = 30 * 60 * 1000;

// Lazy-cached clients — only initialized when first notification fires
let _resend: any = null;
function getResend() {
  if (!_resend) {
    const { Resend } = require("resend");
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

let _twilioClient: any = null;
function getTwilioClient() {
  if (!_twilioClient) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (accountSid && authToken) {
      const twilio = require("twilio");
      _twilioClient = twilio(accountSid, authToken);
    }
  }
  return _twilioClient;
}

async function runCoordinationDigest() {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
    const hasTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && twilioFrom);

    if (!apiKey && !hasTwilio) return;

    // Find all active sheets that have unnotified items
    const sheetsWithPending = await db.listSheetsWithUnnotifiedItems();
    if (sheetsWithPending.length === 0) return;
    console.log(`[CoordinationCron] Found ${sheetsWithPending.length} sheet(s) with pending notifications`);

    const resend = apiKey ? getResend() : null;
    const twilioClient = hasTwilio ? getTwilioClient() : null;
    const baseUrl = process.env.APP_URL || "https://app.studiotrac.app";

    for (const sheet of sheetsWithPending) {
      if (!await isOrganizationWorkspaceAccessible(sheet.organizationId)) continue;
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
      const { subject, html, smsBody } = createSafeCoordinationNotice(sheet, baseUrl);
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
        // SMS (with 10s timeout to prevent long hangs on Twilio API failures)
        if (sub.phone && twilioClient && twilioFrom) {
          try {
            const smsTimeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Twilio SMS timeout after 10s")), 10_000)
            );
            const msg = await Promise.race([
              twilioClient.messages.create({ body: smsBody, from: twilioFrom, to: sub.phone }),
              smsTimeout,
            ]);
            console.log(`[CoordinationCron] SMS sent to ${sub.phone} for sheet "${sheet.projectName}", sid: ${msg.sid}`);
            subSent = true;
          } catch (e: any) {
            console.error(`[CoordinationCron] SMS failed for ${sub.phone}: ${e?.message ?? e}`);
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
