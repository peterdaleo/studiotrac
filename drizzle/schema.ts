import { int, mysqlEnum, mysqlTable, text, mediumtext, timestamp, varchar, boolean, json } from "drizzle-orm/mysql-core";
// ── Organizations ─────────────────────────────────────────────────
export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  logoUrl: varchar("logoUrl", { length: 512 }),
  firmSize: varchar("firmSize", { length: 50 }),
  onboardingCompleted: boolean("onboardingCompleted").default(false).notNull(),
  trialStartedAt: timestamp("trialStartedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;
// ── Users ──────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "pm", "admin"]).default("user").notNull(),
  organizationId: int("organizationId"),
  orgRole: mysqlEnum("orgRole", ["owner", "admin", "member"]).default("member").notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  isSuperAdmin: boolean("isSuperAdmin").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
// ── Team Members ───────────────────────────────────────────────────
export const teamMembers = mysqlTable("team_members", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  userId: int("userId"),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }),
  title: varchar("title", { length: 255 }),
  avatarColor: varchar("avatarColor", { length: 20 }).default("#6366f1"),
  isActive: boolean("isActive").default(true).notNull(),
  billingRate: int("billingRate").default(0).notNull(), // cents per hour
  weeklyCapacityHours: int("weeklyCapacityHours").default(40).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = typeof teamMembers.$inferInsert;
// ── Team Absences ──────────────────────────────────────────────────
export const teamAbsences = mysqlTable("team_absences", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  teamMemberId: int("teamMemberId").notNull(),
  absenceType: mysqlEnum("absenceType", ["full_day", "partial_day", "work_from_home"]).notNull(),
  startDate: timestamp("startDate").notNull(),
  endDate: timestamp("endDate").notNull(),
  startTimeMinutes: int("startTimeMinutes"),
  endTimeMinutes: int("endTimeMinutes"),
  notes: text("notes"),
  createdById: int("createdById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type TeamAbsence = typeof teamAbsences.$inferSelect;
export type InsertTeamAbsence = typeof teamAbsences.$inferInsert;
// ── Projects ───────────────────────────────────────────────────────
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  name: varchar("name", { length: 500 }).notNull(),
  clientName: varchar("clientName", { length: 500 }),
  address: text("address"),
  projectManagerId: int("projectManagerId"),
  status: mysqlEnum("status", ["on_track", "on_hold", "delayed", "completed"]).default("on_track").notNull(),
  phase: mysqlEnum("phase", [
    "pre_design",
    "schematic_design",
    "design_development",
    "construction_documents",
    "bidding_negotiation",
    "construction_administration",
    "post_occupancy",
  ]).default("pre_design").notNull(),
  completionPercentage: int("completionPercentage").default(0).notNull(),
  startDate: timestamp("startDate"),
  deadline: timestamp("deadline"),
  billing25: boolean("billing25").default(false).notNull(),
  billing50: boolean("billing50").default(false).notNull(),
  billing75: boolean("billing75").default(false).notNull(),
  billing100: boolean("billing100").default(false).notNull(),
  billingOk: boolean("billingOk").default(false).notNull(),
  description: text("description"),
  estimatedHours: int("estimatedHours").default(0).notNull(),
  contractedFee: int("contractedFee").default(0).notNull(),
  invoicedAmount: int("invoicedAmount").default(0).notNull(),
  driveFolderUrl: varchar("driveFolderUrl", { length: 2048 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
// ── Invoices ──────────────────────────────────────────────────────
export const invoices = mysqlTable("invoices", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  projectId: int("projectId").notNull(),
  amount: int("amount").notNull(),
  description: varchar("description", { length: 500 }),
  invoiceNumber: varchar("invoiceNumber", { length: 100 }),
  status: mysqlEnum("status", ["draft", "sent", "paid", "overdue"]).default("draft").notNull(),
  invoiceDate: timestamp("invoiceDate").defaultNow().notNull(),
  dueDate: timestamp("dueDate"),
  paidDate: timestamp("paidDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;
// ── Tasks ──────────────────────────────────────────────────────────
export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  projectId: int("projectId").notNull(),
  assigneeId: int("assigneeId"),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["todo", "in_progress", "done", "overdue"]).default("todo").notNull(),
  priority: int("priority").default(10).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  deadline: timestamp("deadline"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;
// ── Project Notes ──────────────────────────────────────────────────
export const projectNotes = mysqlTable("project_notes", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  projectId: int("projectId").notNull(),
  authorId: int("authorId"),
  content: text("content").notNull(),
  isClientVisible: boolean("isClientVisible").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ProjectNote = typeof projectNotes.$inferSelect;
export type InsertProjectNote = typeof projectNotes.$inferInsert;
// ── Notifications ──────────────────────────────────────────────────
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  userId: int("userId"),
  type: mysqlEnum("type", ["deadline_approaching", "task_overdue", "status_change", "general"]).default("general").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  message: text("message"),
  isRead: boolean("isRead").default(false).notNull(),
  relatedProjectId: int("relatedProjectId"),
  relatedTaskId: int("relatedTaskId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
// ── Project Files ──────────────────────────────────────────────────
export const projectFiles = mysqlTable("project_files", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  projectId: int("projectId").notNull(),
  uploadedById: int("uploadedById"),
  fileName: varchar("fileName", { length: 500 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileSize: int("fileSize"),
  mimeType: varchar("mimeType", { length: 255 }),
  category: mysqlEnum("category", ["document", "drawing", "image", "other"]).default("other").notNull(),
  isClientVisible: boolean("isClientVisible").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = typeof projectFiles.$inferInsert;
// ── Email Preferences ──────────────────────────────────────────────
export const emailPreferences = mysqlTable("email_preferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  deadlineAlerts: boolean("deadlineAlerts").default(true).notNull(),
  taskOverdueAlerts: boolean("taskOverdueAlerts").default(true).notNull(),
  statusChangeAlerts: boolean("statusChangeAlerts").default(true).notNull(),
  weeklyDigest: boolean("weeklyDigest").default(false).notNull(),
  alertDaysBefore: int("alertDaysBefore").default(3).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type EmailPreference = typeof emailPreferences.$inferSelect;
export type InsertEmailPreference = typeof emailPreferences.$inferInsert;
// ── Email Log ──────────────────────────────────────────────────────
export const emailLog = mysqlTable("email_log", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  recipientEmail: varchar("recipientEmail", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  body: text("body"),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  relatedProjectId: int("relatedProjectId"),
  relatedTaskId: int("relatedTaskId"),
});
export type EmailLogEntry = typeof emailLog.$inferSelect;
export type InsertEmailLogEntry = typeof emailLog.$inferInsert;
// ── Client Share Tokens ───────────────────────────────────────────
export const clientShareTokens = mysqlTable("client_share_tokens", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  projectId: int("projectId"),
  token: varchar("token", { length: 128 }).notNull().unique(),
  label: varchar("label", { length: 255 }),
  clientName: varchar("clientName", { length: 500 }),
  isActive: boolean("isActive").default(true).notNull(),
  expiresAt: timestamp("expiresAt"),
  createdById: int("createdById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ClientShareToken = typeof clientShareTokens.$inferSelect;
export type InsertClientShareToken = typeof clientShareTokens.$inferInsert;
// ── Consultant Contracts ─────────────────────────────────────────
export const consultantContracts = mysqlTable("consultant_contracts", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 500 }).notNull(),
  discipline: varchar("discipline", { length: 255 }).notNull(),
  contractAmount: int("contractAmount").default(0).notNull(),
  status: mysqlEnum("status", ["active", "completed", "terminated", "pending"]).default("active").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ConsultantContract = typeof consultantContracts.$inferSelect;
export type InsertConsultantContract = typeof consultantContracts.$inferInsert;
// ── Consultant Payments ──────────────────────────────────────────
export const consultantPayments = mysqlTable("consultant_payments", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  consultantId: int("consultantId").notNull(),
  amount: int("amount").notNull(),
  paymentDate: timestamp("paymentDate").defaultNow().notNull(),
  notes: varchar("notes", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ConsultantPayment = typeof consultantPayments.$inferSelect;
export type InsertConsultantPayment = typeof consultantPayments.$inferInsert;
// ── Time Entries ────────────────────────────────────────────────────
export const timeEntries = mysqlTable("time_entries", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  taskId: int("taskId"),
  description: varchar("description", { length: 500 }),
  startTime: timestamp("startTime").notNull(),
  endTime: timestamp("endTime"),
  durationMinutes: int("durationMinutes").default(0).notNull(),
  billable: boolean("billable").default(true).notNull(),
  phase: mysqlEnum("phase", [
    "pre_design",
    "schematic_design",
    "design_development",
    "construction_documents",
    "bidding_negotiation",
    "construction_administration",
    "post_occupancy",
  ]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = typeof timeEntries.$inferInsert;
// ── Billing Department Emails ──────────────────────────────────────
export const billingDepartmentEmails = mysqlTable("billing_department_emails", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  emailAddress: varchar("emailAddress", { length: 320 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type BillingDepartmentEmail = typeof billingDepartmentEmails.$inferSelect;
export type InsertBillingDepartmentEmail = typeof billingDepartmentEmails.$inferInsert;
// ── Waitlist Signups ───────────────────────────────────────────────
export const waitlistSignups = mysqlTable("waitlist_signups", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  firmName: varchar("firmName", { length: 255 }).notNull(),
  firmSize: varchar("firmSize", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type WaitlistSignup = typeof waitlistSignups.$inferSelect;
export type InsertWaitlistSignup = typeof waitlistSignups.$inferInsert;
// ── Subscriptions ──────────────────────────────────────────────────
export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  userId: int("userId").notNull(),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }).notNull().unique(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }).notNull(),
  stripePriceId: varchar("stripePriceId", { length: 255 }).notNull(),
  plan: mysqlEnum("plan", ["starter", "professional", "enterprise"]).notNull(),
  status: mysqlEnum("status", ["active", "canceled", "past_due", "incomplete", "trialing", "unpaid"]).default("active").notNull(),
  currentPeriodStart: timestamp("currentPeriodStart"),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false).notNull(),
  canceledAt: timestamp("canceledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// ── Coordination Sheets ──────────────────────────────────────────
export const coordinationSheets = mysqlTable("coordination_sheets", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  projectId: int("projectId").notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  clientToken: varchar("clientToken", { length: 128 }),
  projectName: varchar("projectName", { length: 500 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sharedFolderUrl: varchar("sharedFolderUrl", { length: 2048 }),
  createdById: int("createdById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CoordinationSheet = typeof coordinationSheets.$inferSelect;
export type InsertCoordinationSheet = typeof coordinationSheets.$inferInsert;

export const coordinationItems = mysqlTable("coordination_items", {
  id: int("id").autoincrement().primaryKey(),
  sheetId: int("sheetId").notNull(),
  parentId: int("parentId"),
  authorName: varchar("authorName", { length: 255 }).notNull(),
  authorType: mysqlEnum("authorType", ["project_lead", "architectural", "structural", "civil", "mechanical", "plumbing", "landscaping", "other"]).default("other").notNull(),
  content: text("content").notNull(),
  isUrgent: boolean("isUrgent").default(false).notNull(),
  isAddressed: boolean("isAddressed").default(false).notNull(),
  isNotified: boolean("isNotified").default(false).notNull(),
  visibility: mysqlEnum("visibility", ["internal", "client"]).default("internal").notNull(),
  pinnedAt: timestamp("pinnedAt"), // nullable — null means not pinned
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  editedAt: timestamp("editedAt"),
});
export type CoordinationItem = typeof coordinationItems.$inferSelect;
export type InsertCoordinationItem = typeof coordinationItems.$inferInsert;

export const coordinationAttachments = mysqlTable("coordination_attachments", {
  id: int("id").autoincrement().primaryKey(),
  itemId: int("itemId").notNull(),
  type: mysqlEnum("type", ["image", "link"]).default("link").notNull(),
  url: varchar("url", { length: 2048 }).notNull(),
  fileName: varchar("fileName", { length: 500 }),
  fileKey: varchar("fileKey", { length: 500 }),
  fileData: mediumtext("fileData"), // base64-encoded image data for persistent storage (up to 16MB)
  mimeType: varchar("mimeType", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CoordinationAttachment = typeof coordinationAttachments.$inferSelect;
export type InsertCoordinationAttachment = typeof coordinationAttachments.$inferInsert;

export const coordinationSubscribers = mysqlTable("coordination_subscribers", {
  id: int("id").autoincrement().primaryKey(),
  sheetId: int("sheetId").notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 32 }),
  name: varchar("name", { length: 255 }),
  lastNotifiedAt: timestamp("lastNotifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CoordinationSubscriber = typeof coordinationSubscribers.$inferSelect;
export type InsertCoordinationSubscriber = typeof coordinationSubscribers.$inferInsert;

export const coordinationSheetViews = mysqlTable("coordination_sheet_views", {
  id: int("id").autoincrement().primaryKey(),
  sheetId: int("sheetId").notNull(),
  userId: int("userId").notNull(),
  lastViewedAt: timestamp("lastViewedAt").defaultNow().notNull(),
});
export type CoordinationSheetView = typeof coordinationSheetViews.$inferSelect;

// ── Project Team Members ─────────────────────────────────────────
export const projectTeamMembers = mysqlTable("project_team_members", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  teamMemberId: int("teamMemberId").notNull(),
  role: mysqlEnum("role", ["designer", "pm", "production"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ProjectTeamMember = typeof projectTeamMembers.$inferSelect;
export type InsertProjectTeamMember = typeof projectTeamMembers.$inferInsert;
