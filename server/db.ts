import { eq, desc, asc, and, sql, lte, gte, ne, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  projects, InsertProject, Project,
  tasks, InsertTask, Task,
  teamMembers, InsertTeamMember, TeamMember,
  projectNotes, InsertProjectNote,
  notifications, InsertNotification,
  projectFiles, InsertProjectFile,
  emailPreferences, InsertEmailPreference,
  emailLog, InsertEmailLogEntry,
  clientShareTokens, InsertClientShareToken,
  invoices, InsertInvoice,
  consultantContracts, InsertConsultantContract,
  consultantPayments, InsertConsultantPayment,
  timeEntries, InsertTimeEntry,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ── Users ──────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    if (user.passwordHash !== undefined) { values.passwordHash = user.passwordHash; updateSet.passwordHash = user.passwordHash; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ── Team Members ───────────────────────────────────────────────────
export async function listTeamMembers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(teamMembers).where(eq(teamMembers.isActive, true)).orderBy(asc(teamMembers.name));
}

export async function getTeamMember(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(teamMembers).where(eq(teamMembers.id, id)).limit(1);
  return result[0];
}

export async function createTeamMember(data: InsertTeamMember) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(teamMembers).values(data);
  return { id: result[0].insertId };
}

export async function updateTeamMember(id: number, data: Partial<InsertTeamMember>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(teamMembers).set(data).where(eq(teamMembers.id, id));
}

export async function deleteTeamMember(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(teamMembers).set({ isActive: false }).where(eq(teamMembers.id, id));
}

export async function updateUserRole(userId: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function listUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: users.id, openId: users.openId, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt }).from(users).orderBy(asc(users.name));
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function inviteTeamMember(data: { name: string; email: string; title?: string; role?: "user" | "admin" }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalizedEmail = data.email.trim().toLowerCase();
  // Create a team member record as a placeholder for the invited user
  const result = await db.insert(teamMembers).values({
    name: data.name,
    email: normalizedEmail,
    title: data.title ?? null,
    isActive: true,
  });
  return { id: result[0].insertId };
}

export async function linkUserToInvitedTeamMember(data: { teamMemberId: number; userId: number; email: string; name?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedEmail = data.email.trim().toLowerCase();
  const result = await db.select().from(teamMembers).where(eq(teamMembers.id, data.teamMemberId)).limit(1);
  const member = result[0];

  if (!member) return false;
  if ((member.email ?? "").trim().toLowerCase() !== normalizedEmail) return false;

  const update: Partial<InsertTeamMember> = {
    userId: data.userId,
    email: normalizedEmail,
  };

  if (data.name?.trim()) {
    update.name = data.name.trim();
  }

  await db.update(teamMembers).set(update).where(eq(teamMembers.id, data.teamMemberId));
  return true;
}

// ── Projects ───────────────────────────────────────────────────────
export async function listProjects(filters?: { status?: string; phase?: string; managerId?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.status) conditions.push(eq(projects.status, filters.status as any));
  if (filters?.phase) conditions.push(eq(projects.phase, filters.phase as any));
  if (filters?.managerId) conditions.push(eq(projects.projectManagerId, filters.managerId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(projects).where(where).orderBy(desc(projects.updatedAt));
}

export async function getProject(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return result[0];
}

export async function createProject(data: InsertProject) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projects).values(data);
  return { id: result[0].insertId };
}

export async function updateProject(id: number, data: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projects).set(data).where(eq(projects.id, id));
}

export async function deleteProject(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(tasks).where(eq(tasks.projectId, id));
  await db.delete(projectNotes).where(eq(projectNotes.projectId, id));
  await db.delete(projectFiles).where(eq(projectFiles.projectId, id));
  await db.delete(invoices).where(eq(invoices.projectId, id));
  await db.delete(clientShareTokens).where(eq(clientShareTokens.projectId, id));
  // Delete consultant payments for all consultants on this project
  const projectConsultants = await db.select({ id: consultantContracts.id }).from(consultantContracts).where(eq(consultantContracts.projectId, id));
  for (const c of projectConsultants) {
    await db.delete(consultantPayments).where(eq(consultantPayments.consultantId, c.id));
  }
  await db.delete(consultantContracts).where(eq(consultantContracts.projectId, id));
  await db.delete(timeEntries).where(eq(timeEntries.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
}

// ── Tasks ──────────────────────────────────────────────────────────
export async function listTasks(filters?: { projectId?: number; assigneeId?: number; status?: string }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.projectId) conditions.push(eq(tasks.projectId, filters.projectId));
  if (filters?.assigneeId) conditions.push(eq(tasks.assigneeId, filters.assigneeId));
  if (filters?.status) conditions.push(eq(tasks.status, filters.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(tasks).where(where).orderBy(asc(tasks.sortOrder), asc(tasks.priority));
}

export async function getTask(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return result[0];
}

export async function createTask(data: InsertTask) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(tasks).values(data);
  return { id: result[0].insertId };
}

export async function updateTask(id: number, data: Partial<InsertTask>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(tasks).set(data).where(eq(tasks.id, id));
}

export async function deleteTask(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(tasks).where(eq(tasks.id, id));
}

export async function reorderTasks(taskOrders: { id: number; sortOrder: number }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (const t of taskOrders) {
    await db.update(tasks).set({ sortOrder: t.sortOrder }).where(eq(tasks.id, t.id));
  }
}

// ── Project Notes ──────────────────────────────────────────────────
export async function listProjectNotes(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectNotes).where(eq(projectNotes.projectId, projectId)).orderBy(desc(projectNotes.createdAt));
}

export async function createProjectNote(data: InsertProjectNote) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectNotes).values(data);
  return { id: result[0].insertId };
}

export async function updateProjectNote(id: number, data: Partial<InsertProjectNote>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectNotes).set(data).where(eq(projectNotes.id, id));
}

export async function deleteProjectNote(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectNotes).where(eq(projectNotes.id, id));
}

// ── Notifications ──────────────────────────────────────────────────
export async function listNotifications(userId?: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (userId) conditions.push(or(eq(notifications.userId, userId), isNull(notifications.userId)));
  else conditions.push(isNull(notifications.userId));
  return db.select().from(notifications).where(and(...conditions)).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(notifications).values(data);
  return { id: result[0].insertId };
}

export async function markNotificationRead(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
}

export async function markAllNotificationsRead(userId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [eq(notifications.isRead, false)];
  if (userId) conditions.push(or(eq(notifications.userId, userId), isNull(notifications.userId))!);
  await db.update(notifications).set({ isRead: true }).where(and(...conditions));
}

export async function getUnreadNotificationCount(userId?: number) {
  const db = await getDb();
  if (!db) return 0;
  const conditions = [eq(notifications.isRead, false)];
  if (userId) conditions.push(or(eq(notifications.userId, userId), isNull(notifications.userId))!);
  const result = await db.select({ count: sql<number>`count(*)` }).from(notifications).where(and(...conditions));
  return result[0]?.count ?? 0;
}

// ── Project Files ─────────────────────────────────────────────────
export async function listProjectFiles(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(desc(projectFiles.createdAt));
}

export async function createProjectFile(data: InsertProjectFile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectFiles).values(data);
  return { id: result[0].insertId };
}

export async function deleteProjectFile(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const file = await db.select().from(projectFiles).where(eq(projectFiles.id, id)).limit(1);
  await db.delete(projectFiles).where(eq(projectFiles.id, id));
  return file[0];
}

export async function getProjectFileCount(projectId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(projectFiles).where(eq(projectFiles.projectId, projectId));
  return result[0]?.count ?? 0;
}

// ── Email Preferences ─────────────────────────────────────────────
export async function getEmailPreferences(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(emailPreferences).where(eq(emailPreferences.userId, userId)).limit(1);
  return result[0];
}

export async function upsertEmailPreferences(userId: number, data: Partial<InsertEmailPreference>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(emailPreferences).where(eq(emailPreferences.userId, userId)).limit(1);
  if (existing.length > 0) {
    await db.update(emailPreferences).set(data).where(eq(emailPreferences.userId, userId));
    return { id: existing[0]!.id };
  } else {
    const result = await db.insert(emailPreferences).values({ userId, emailAddress: data.emailAddress || '', ...data });
    return { id: result[0].insertId };
  }
}

// ── Email Log ─────────────────────────────────────────────────────
export async function logEmail(data: InsertEmailLogEntry) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(emailLog).values(data);
  return { id: result[0].insertId };
}

export async function listEmailLog(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailLog).orderBy(desc(emailLog.sentAt)).limit(limit);
}

// ── Deadline Check (for email notifications) ──────────────────────
export async function getUpcomingDeadlineTasks(daysAhead: number) {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 86400000);
  return db.select().from(tasks)
    .where(and(
      ne(tasks.status, 'done'),
      ne(tasks.status, 'overdue'),
      lte(tasks.deadline, future),
      gte(tasks.deadline, now)
    ))
    .orderBy(asc(tasks.deadline));
}

export async function getOverdueTasks() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tasks)
    .where(eq(tasks.status, 'overdue'))
    .orderBy(asc(tasks.deadline));
}

export async function getUpcomingDeadlineProjects(daysAhead: number) {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 86400000);
  return db.select().from(projects)
    .where(and(
      ne(projects.status, 'completed'),
      lte(projects.deadline, future),
      gte(projects.deadline, now)
    ))
    .orderBy(asc(projects.deadline));
}

// ── Gantt Data ────────────────────────────────────────────────────
export async function getGanttData() {
  const db = await getDb();
  if (!db) return { projects: [], tasks: [], members: [] };
  const allProjects = await db.select().from(projects).where(ne(projects.status, 'completed')).orderBy(asc(projects.startDate));
  const allTasks = await db.select().from(tasks).where(ne(tasks.status, 'done')).orderBy(asc(tasks.deadline));
  const allMembers = await db.select().from(teamMembers).where(eq(teamMembers.isActive, true));
  return { projects: allProjects, tasks: allTasks, members: allMembers };
}

// ── Invoices ──────────────────────────────────────────────────────
export async function listInvoices(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(invoices).where(eq(invoices.projectId, projectId)).orderBy(desc(invoices.invoiceDate));
}

export async function createInvoice(data: InsertInvoice) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(invoices).values(data);
  // Recalculate project invoiced amount
  await recalcProjectInvoiced(data.projectId);
  return { id: result[0].insertId };
}

export async function updateInvoice(id: number, data: Partial<InsertInvoice>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Get the invoice to know its projectId
  const existing = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  await db.update(invoices).set(data).where(eq(invoices.id, id));
  if (existing[0]) await recalcProjectInvoiced(existing[0].projectId);
}

export async function deleteInvoice(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  await db.delete(invoices).where(eq(invoices.id, id));
  if (existing[0]) await recalcProjectInvoiced(existing[0].projectId);
}

async function recalcProjectInvoiced(projectId: number) {
  const db = await getDb();
  if (!db) return;
  const result = await db.select({
    total: sql<number>`COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0)`,
  }).from(invoices).where(eq(invoices.projectId, projectId));
  const totalPaid = Number(result[0]?.total ?? 0);
  await db.update(projects).set({ invoicedAmount: totalPaid }).where(eq(projects.id, projectId));
}

// ── Financial Overview ────────────────────────────────────────────
export async function getFinancialOverview() {
  const db = await getDb();
  if (!db) return { projects: [], totals: { contracted: 0, invoiced: 0, outstanding: 0, paid: 0, consultantPaid: 0, netIncome: 0 } };
  const allProjects = await db.select().from(projects).orderBy(desc(projects.updatedAt));
  const allInvoices = await db.select().from(invoices).orderBy(desc(invoices.invoiceDate));
  const allContracts = await db.select().from(consultantContracts);
  const allPayments = await db.select().from(consultantPayments);
  
  let totalContracted = 0;
  let totalInvoiced = 0;
  let totalPaid = 0;
  let totalConsultantPaid = 0;
  
  const projectFinancials = allProjects.map(p => {
    const projectInvoices = allInvoices.filter(i => i.projectId === p.id);
    const invoicedTotal = projectInvoices.reduce((sum, i) => sum + i.amount, 0);
    const paidTotal = projectInvoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.amount, 0);
    
    // Calculate consultant costs for this project
    const projectContracts = allContracts.filter(c => c.projectId === p.id);
    let projectConsultantPaid = 0;
    let projectConsultantContracted = 0;
    for (const c of projectContracts) {
      projectConsultantContracted += c.contractAmount;
      const payments = allPayments.filter(pay => pay.consultantId === c.id);
      projectConsultantPaid += payments.reduce((sum, pay) => sum + pay.amount, 0);
    }
    
    totalContracted += p.contractedFee;
    totalInvoiced += invoicedTotal;
    totalPaid += paidTotal;
    totalConsultantPaid += projectConsultantPaid;
    
    return {
      ...p,
      invoiceCount: projectInvoices.length,
      totalInvoiced: invoicedTotal,
      totalPaid: paidTotal,
      outstanding: invoicedTotal - paidTotal,
      consultantContracted: projectConsultantContracted,
      consultantPaid: projectConsultantPaid,
      netIncome: paidTotal - projectConsultantPaid,
      consultantCount: projectContracts.length,
    };
  });
  
  return {
    projects: projectFinancials,
    totals: {
      contracted: totalContracted,
      invoiced: totalInvoiced,
      outstanding: totalInvoiced - totalPaid,
      paid: totalPaid,
      consultantPaid: totalConsultantPaid,
      netIncome: totalPaid - totalConsultantPaid,
    },
  };
}

// ── Export Data Helpers ──────────────────────────────────────────
export async function getExportProjectsSummary() {
  const db = await getDb();
  if (!db) return [];
  const allProjects = await db.select().from(projects).orderBy(asc(projects.name));
  const allMembers = await db.select().from(teamMembers);
  return allProjects.map(p => {
    const manager = allMembers.find(m => m.id === p.projectManagerId);
    return {
      name: p.name,
      client: p.clientName || '',
      manager: manager?.name || 'Unassigned',
      status: p.status,
      phase: p.phase,
      completion: p.completionPercentage,
      startDate: p.startDate?.toISOString().split('T')[0] || '',
      deadline: p.deadline?.toISOString().split('T')[0] || '',
      contractedFee: (p.contractedFee / 100).toFixed(2),
      invoicedAmount: (p.invoicedAmount / 100).toFixed(2),
    };
  });
}

export async function getExportTasksList() {
  const db = await getDb();
  if (!db) return [];
  const allTasks = await db.select().from(tasks).orderBy(asc(tasks.priority));
  const allMembers = await db.select().from(teamMembers);
  const allProjects = await db.select().from(projects);
  return allTasks.map(t => {
    const assignee = allMembers.find(m => m.id === t.assigneeId);
    const project = allProjects.find(p => p.id === t.projectId);
    return {
      title: t.title,
      project: project?.name || '',
      assignee: assignee?.name || 'Unassigned',
      status: t.status,
      priority: t.priority,
      deadline: t.deadline?.toISOString().split('T')[0] || '',
      completedAt: t.completedAt?.toISOString().split('T')[0] || '',
    };
  });
}

export async function getExportTeamWorkload() {
  const db = await getDb();
  if (!db) return [];
  const allMembers = await db.select().from(teamMembers).where(eq(teamMembers.isActive, true));
  const allTasks = await db.select().from(tasks);
  return allMembers.map(m => {
    const memberTasks = allTasks.filter(t => t.assigneeId === m.id);
    const completed = memberTasks.filter(t => t.status === 'done').length;
    const overdue = memberTasks.filter(t => t.status === 'overdue').length;
    const inProgress = memberTasks.filter(t => t.status === 'in_progress').length;
    return {
      name: m.name,
      title: m.title || '',
      email: m.email || '',
      totalTasks: memberTasks.length,
      completed,
      inProgress,
      overdue,
      completionRate: memberTasks.length > 0 ? ((completed / memberTasks.length) * 100).toFixed(1) : '0.0',
    };
  });
}

// ── Dashboard Stats ────────────────────────────────────────────────
export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return { totalProjects: 0, onTrack: 0, delayed: 0, onHold: 0, completed: 0, totalTasks: 0, overdueTasks: 0, completedTasks: 0 };

  const projectStats = await db.select({
    total: sql<number>`count(*)`,
    onTrack: sql<number>`sum(case when status = 'on_track' then 1 else 0 end)`,
    delayed: sql<number>`sum(case when status = 'delayed' then 1 else 0 end)`,
    onHold: sql<number>`sum(case when status = 'on_hold' then 1 else 0 end)`,
    completed: sql<number>`sum(case when status = 'completed' then 1 else 0 end)`,
  }).from(projects);

  const taskStats = await db.select({
    total: sql<number>`count(*)`,
    overdue: sql<number>`sum(case when status = 'overdue' then 1 else 0 end)`,
    completed: sql<number>`sum(case when status = 'done' then 1 else 0 end)`,
  }).from(tasks);

  return {
    totalProjects: Number(projectStats[0]?.total ?? 0),
    onTrack: Number(projectStats[0]?.onTrack ?? 0),
    delayed: Number(projectStats[0]?.delayed ?? 0),
    onHold: Number(projectStats[0]?.onHold ?? 0),
    completed: Number(projectStats[0]?.completed ?? 0),
    totalTasks: Number(taskStats[0]?.total ?? 0),
    overdueTasks: Number(taskStats[0]?.overdue ?? 0),
    completedTasks: Number(taskStats[0]?.completed ?? 0),
  };
}

// ── Team Stats ─────────────────────────────────────────────────────
export async function getTeamMemberStats(memberId: number) {
  const db = await getDb();
  if (!db) return { assignedTasks: 0, completedTasks: 0, overdueTasks: 0, activeProjects: 0 };

  const taskResult = await db.select({
    assigned: sql<number>`count(*)`,
    completed: sql<number>`sum(case when status = 'done' then 1 else 0 end)`,
    overdue: sql<number>`sum(case when status = 'overdue' then 1 else 0 end)`,
  }).from(tasks).where(eq(tasks.assigneeId, memberId));

  const projectResult = await db.select({
    count: sql<number>`count(distinct projectId)`,
  }).from(tasks).where(and(eq(tasks.assigneeId, memberId), ne(tasks.status, "done")));

  return {
    assignedTasks: Number(taskResult[0]?.assigned ?? 0),
    completedTasks: Number(taskResult[0]?.completed ?? 0),
    overdueTasks: Number(taskResult[0]?.overdue ?? 0),
    activeProjects: Number(projectResult[0]?.count ?? 0),
  };
}

// ── Client Share Tokens ──────────────────────────────────────────
export async function createShareToken(data: InsertClientShareToken) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(clientShareTokens).values(data);
  return { id: result[0].insertId };
}

export async function listShareTokens(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(clientShareTokens).where(eq(clientShareTokens.projectId, projectId)).orderBy(desc(clientShareTokens.createdAt));
}

export async function getShareToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(clientShareTokens).where(and(eq(clientShareTokens.token, token), eq(clientShareTokens.isActive, true))).limit(1);
  if (!result[0]) return undefined;
  // Check expiration
  if (result[0].expiresAt && result[0].expiresAt < new Date()) return undefined;
  return result[0];
}

export async function revokeShareToken(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(clientShareTokens).set({ isActive: false }).where(eq(clientShareTokens.id, id));
}

export async function getPublicProjectData(projectId: number) {
  const db = await getDb();
  if (!db) return null;
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project[0]) return null;
  // Get client-visible notes only
  const visibleNotes = await db.select().from(projectNotes).where(and(eq(projectNotes.projectId, projectId), eq(projectNotes.isClientVisible, true))).orderBy(desc(projectNotes.createdAt));
  // Get files
  const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(desc(projectFiles.createdAt));
  // Get project manager name
  let managerName = null;
  if (project[0].projectManagerId) {
    const manager = await db.select().from(teamMembers).where(eq(teamMembers.id, project[0].projectManagerId)).limit(1);
    managerName = manager[0]?.name ?? null;
  }
  return {
    project: {
      name: project[0].name,
      clientName: project[0].clientName,
      address: project[0].address,
      status: project[0].status,
      phase: project[0].phase,
      completionPercentage: project[0].completionPercentage,
      startDate: project[0].startDate,
      deadline: project[0].deadline,
      billing25: project[0].billing25,
      billing50: project[0].billing50,
      billing75: project[0].billing75,
      billing100: project[0].billing100,
      billingOk: project[0].billingOk,
      description: project[0].description,
      managerName,
    },
    notes: visibleNotes,
    files,
  };
}

// ── Consultant Contracts ──────────────────────────────────────────
export async function listConsultantContracts(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(consultantContracts).where(eq(consultantContracts.projectId, projectId)).orderBy(asc(consultantContracts.discipline));
}

export async function createConsultantContract(data: InsertConsultantContract) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(consultantContracts).values(data);
  return { id: result[0].insertId };
}

export async function updateConsultantContract(id: number, data: Partial<InsertConsultantContract>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(consultantContracts).set(data).where(eq(consultantContracts.id, id));
}

export async function deleteConsultantContract(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(consultantPayments).where(eq(consultantPayments.consultantId, id));
  await db.delete(consultantContracts).where(eq(consultantContracts.id, id));
}

// ── Consultant Payments ──────────────────────────────────────────
export async function listConsultantPayments(consultantId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(consultantPayments).where(eq(consultantPayments.consultantId, consultantId)).orderBy(desc(consultantPayments.paymentDate));
}

export async function createConsultantPayment(data: InsertConsultantPayment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(consultantPayments).values(data);
  return { id: result[0].insertId };
}

export async function deleteConsultantPayment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(consultantPayments).where(eq(consultantPayments.id, id));
}

// ── Net Income Calculation ──────────────────────────────────────
export async function getProjectNetIncome(projectId: number) {
  const db = await getDb();
  if (!db) return { feesCollected: 0, consultantPaymentsTotal: 0, netIncome: 0, consultants: [] as any[] };
  
  // Get paid invoices
  const paidInvoices = await db.select().from(invoices).where(and(eq(invoices.projectId, projectId), eq(invoices.status, 'paid')));
  const feesCollected = paidInvoices.reduce((sum, i) => sum + i.amount, 0);
  
  // Get all consultants and their payments
  const contracts = await db.select().from(consultantContracts).where(eq(consultantContracts.projectId, projectId));
  let consultantPaymentsTotal = 0;
  const consultantsWithPayments = [];
  
  for (const contract of contracts) {
    const payments = await db.select().from(consultantPayments).where(eq(consultantPayments.consultantId, contract.id));
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    consultantPaymentsTotal += totalPaid;
    consultantsWithPayments.push({
      ...contract,
      payments,
      totalPaid,
      remaining: contract.contractAmount - totalPaid,
    });
  }
  
  return {
    feesCollected,
    consultantPaymentsTotal,
    netIncome: feesCollected - consultantPaymentsTotal,
    consultants: consultantsWithPayments,
  };
}

export async function getStudioNetIncome() {
  const db = await getDb();
  if (!db) return { totalFeesCollected: 0, totalConsultantPayments: 0, totalNetIncome: 0, projectBreakdown: [] as any[] };
  
  const allProjects = await db.select().from(projects);
  const allInvoices = await db.select().from(invoices);
  const allContracts = await db.select().from(consultantContracts);
  const allPayments = await db.select().from(consultantPayments);
  
  let totalFeesCollected = 0;
  let totalConsultantPayments = 0;
  const projectBreakdown = [];
  
  for (const p of allProjects) {
    const paidInvoices = allInvoices.filter(i => i.projectId === p.id && i.status === 'paid');
    const feesCollected = paidInvoices.reduce((sum, i) => sum + i.amount, 0);
    
    const projectContracts = allContracts.filter(c => c.projectId === p.id);
    let consultantPaid = 0;
    let totalContractValue = 0;
    for (const c of projectContracts) {
      totalContractValue += c.contractAmount;
      const payments = allPayments.filter(pay => pay.consultantId === c.id);
      consultantPaid += payments.reduce((sum, pay) => sum + pay.amount, 0);
    }
    
    totalFeesCollected += feesCollected;
    totalConsultantPayments += consultantPaid;
    
    projectBreakdown.push({
      id: p.id,
      name: p.name,
      feesCollected,
      consultantPaid,
      totalContractValue,
      netIncome: feesCollected - consultantPaid,
      consultantCount: projectContracts.length,
    });
  }
  
  return {
    totalFeesCollected,
    totalConsultantPayments,
    totalNetIncome: totalFeesCollected - totalConsultantPayments,
    projectBreakdown,
  };
}

// ── Time Entries ──────────────────────────────────────────────────
export async function listTimeEntries(filters?: { userId?: number; projectId?: number; startDate?: Date; endDate?: Date; billable?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.userId) conditions.push(eq(timeEntries.userId, filters.userId));
  if (filters?.projectId) conditions.push(eq(timeEntries.projectId, filters.projectId));
  if (filters?.startDate) conditions.push(gte(timeEntries.startTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(timeEntries.startTime, filters.endDate));
  if (filters?.billable !== undefined) conditions.push(eq(timeEntries.billable, filters.billable));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(timeEntries).where(where).orderBy(desc(timeEntries.startTime));
}

export async function createTimeEntry(data: InsertTimeEntry) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(timeEntries).values(data);
  return { id: result[0].insertId };
}

export async function updateTimeEntry(id: number, data: Partial<InsertTimeEntry>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(timeEntries).set(data).where(eq(timeEntries.id, id));
}

export async function deleteTimeEntry(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(timeEntries).where(eq(timeEntries.id, id));
}

export async function getActiveTimer(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime))).limit(1);
  return result[0];
}

export async function stopTimer(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const entry = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
  if (!entry[0]) throw new Error("Time entry not found");
  const endTime = new Date();
  const durationMinutes = Math.round((endTime.getTime() - entry[0].startTime.getTime()) / 60000);
  await db.update(timeEntries).set({ endTime, durationMinutes }).where(eq(timeEntries.id, id));
  return { durationMinutes };
}

// ── Time Analytics ────────────────────────────────────────────────
export async function getProjectTimeBreakdown(projectId: number) {
  const db = await getDb();
  if (!db) return { totalMinutes: 0, billableMinutes: 0, byMember: [] as any[], byPhase: [] as any[], estimatedHours: 0 };
  
  const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.projectId, projectId), sql`${timeEntries.endTime} IS NOT NULL`));
  const members = await db.select().from(teamMembers);
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  
  const totalMinutes = entries.reduce((s, e) => s + e.durationMinutes, 0);
  const billableMinutes = entries.filter(e => e.billable).reduce((s, e) => s + e.durationMinutes, 0);
  
  // By member
  const memberMap = new Map<number, { name: string; minutes: number; billableMinutes: number; billingRate: number }>();
  for (const e of entries) {
    const m = members.find(m => m.id === e.userId);
    if (!memberMap.has(e.userId)) memberMap.set(e.userId, { name: m?.name || 'Unknown', minutes: 0, billableMinutes: 0, billingRate: m?.billingRate || 0 });
    const rec = memberMap.get(e.userId)!;
    rec.minutes += e.durationMinutes;
    if (e.billable) rec.billableMinutes += e.durationMinutes;
  }
  
  // By phase
  const phaseMap = new Map<string, number>();
  for (const e of entries) {
    const phase = e.phase || 'unassigned';
    phaseMap.set(phase, (phaseMap.get(phase) || 0) + e.durationMinutes);
  }
  
  return {
    totalMinutes,
    billableMinutes,
    estimatedHours: project[0]?.estimatedHours || 0,
    byMember: Array.from(memberMap.entries()).map(([id, data]) => ({ userId: id, ...data })),
    byPhase: Array.from(phaseMap.entries()).map(([phase, minutes]) => ({ phase, minutes })),
  };
}

export async function getProjectLaborCost(projectId: number) {
  const db = await getDb();
  if (!db) return { totalLaborCost: 0, billableLaborCost: 0 };
  
  const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.projectId, projectId), sql`${timeEntries.endTime} IS NOT NULL`));
  const members = await db.select().from(teamMembers);
  
  let totalLaborCost = 0;
  let billableLaborCost = 0;
  for (const e of entries) {
    const m = members.find(m => m.id === e.userId);
    const hourlyRate = m?.billingRate || 0; // cents per hour
    const cost = Math.round((e.durationMinutes / 60) * hourlyRate);
    totalLaborCost += cost;
    if (e.billable) billableLaborCost += cost;
  }
  
  return { totalLaborCost, billableLaborCost };
}

export async function getProjectBurnRate(projectId: number) {
  const db = await getDb();
  if (!db) return { budgetConsumedPercent: 0, timelineElapsedPercent: 0, laborCost: 0, consultantCost: 0, contractedFee: 0 };
  
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project[0]) return { budgetConsumedPercent: 0, timelineElapsedPercent: 0, laborCost: 0, consultantCost: 0, contractedFee: 0 };
  
  const { totalLaborCost } = await getProjectLaborCost(projectId);
  
  // Get consultant payments total
  const contracts = await db.select().from(consultantContracts).where(eq(consultantContracts.projectId, projectId));
  let consultantCost = 0;
  for (const c of contracts) {
    const payments = await db.select().from(consultantPayments).where(eq(consultantPayments.consultantId, c.id));
    consultantCost += payments.reduce((s, p) => s + p.amount, 0);
  }
  
  const totalCost = totalLaborCost + consultantCost;
  const contractedFee = project[0].contractedFee || 1;
  const budgetConsumedPercent = Math.round((totalCost / contractedFee) * 100);
  
  // Timeline elapsed
  const start = project[0].startDate ? new Date(project[0].startDate).getTime() : Date.now();
  const end = project[0].deadline ? new Date(project[0].deadline).getTime() : Date.now();
  const now = Date.now();
  const totalDuration = end - start || 1;
  const elapsed = now - start;
  const timelineElapsedPercent = Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)));
  
  return { budgetConsumedPercent, timelineElapsedPercent, laborCost: totalLaborCost, consultantCost, contractedFee: project[0].contractedFee || 0 };
}

export async function getFirmUtilization(startDate?: Date, endDate?: Date) {
  const db = await getDb();
  if (!db) return { members: [] as any[], firmBillableHours: 0, firmTotalHours: 0, firmUtilizationRate: 0 };
  
  const members = await db.select().from(teamMembers).where(eq(teamMembers.isActive, true));
  const conditions = [sql`${timeEntries.endTime} IS NOT NULL`];
  if (startDate) conditions.push(gte(timeEntries.startTime, startDate));
  if (endDate) conditions.push(lte(timeEntries.startTime, endDate));
  const entries = await db.select().from(timeEntries).where(and(...conditions));
  
  let firmBillableMinutes = 0;
  let firmTotalMinutes = 0;
  
  const memberStats = members.map(m => {
    const memberEntries = entries.filter(e => e.userId === m.id);
    const totalMinutes = memberEntries.reduce((s, e) => s + e.durationMinutes, 0);
    const billableMinutes = memberEntries.filter(e => e.billable).reduce((s, e) => s + e.durationMinutes, 0);
    firmBillableMinutes += billableMinutes;
    firmTotalMinutes += totalMinutes;
    
    return {
      id: m.id,
      name: m.name,
      title: m.title,
      billingRate: m.billingRate,
      weeklyCapacity: m.weeklyCapacityHours,
      totalHours: Math.round(totalMinutes / 60 * 10) / 10,
      billableHours: Math.round(billableMinutes / 60 * 10) / 10,
      utilizationRate: totalMinutes > 0 ? Math.round((billableMinutes / totalMinutes) * 100) : 0,
      laborCost: Math.round((totalMinutes / 60) * m.billingRate),
    };
  });
  
  return {
    members: memberStats,
    firmBillableHours: Math.round(firmBillableMinutes / 60 * 10) / 10,
    firmTotalHours: Math.round(firmTotalMinutes / 60 * 10) / 10,
    firmUtilizationRate: firmTotalMinutes > 0 ? Math.round((firmBillableMinutes / firmTotalMinutes) * 100) : 0,
  };
}

export async function getTrueProfitability() {
  const db = await getDb();
  if (!db) return { projects: [] as any[], firmTotal: { feesCollected: 0, laborCost: 0, consultantCost: 0, netProfit: 0 } };
  
  const allProjects = await db.select().from(projects);
  const allInvoices = await db.select().from(invoices);
  const allContracts = await db.select().from(consultantContracts);
  const allPayments = await db.select().from(consultantPayments);
  const allEntries = await db.select().from(timeEntries).where(sql`${timeEntries.endTime} IS NOT NULL`);
  const allMembers = await db.select().from(teamMembers);
  
  let firmFeesCollected = 0;
  let firmLaborCost = 0;
  let firmConsultantCost = 0;
  
  const projectProfitability = allProjects.map(p => {
    const paidInvoices = allInvoices.filter(i => i.projectId === p.id && i.status === 'paid');
    const feesCollected = paidInvoices.reduce((s, i) => s + i.amount, 0);
    
    const projectContracts = allContracts.filter(c => c.projectId === p.id);
    let consultantCost = 0;
    for (const c of projectContracts) {
      const payments = allPayments.filter(pay => pay.consultantId === c.id);
      consultantCost += payments.reduce((s, pay) => s + pay.amount, 0);
    }
    
    const projectEntries = allEntries.filter(e => e.projectId === p.id);
    let laborCost = 0;
    for (const e of projectEntries) {
      const m = allMembers.find(m => m.id === e.userId);
      laborCost += Math.round((e.durationMinutes / 60) * (m?.billingRate || 0));
    }
    
    firmFeesCollected += feesCollected;
    firmLaborCost += laborCost;
    firmConsultantCost += consultantCost;
    
    return {
      id: p.id,
      name: p.name,
      contractedFee: p.contractedFee,
      feesCollected,
      laborCost,
      consultantCost,
      totalCost: laborCost + consultantCost,
      netProfit: feesCollected - laborCost - consultantCost,
      profitMargin: feesCollected > 0 ? Math.round(((feesCollected - laborCost - consultantCost) / feesCollected) * 100) : 0,
    };
  });
  
  return {
    projects: projectProfitability,
    firmTotal: {
      feesCollected: firmFeesCollected,
      laborCost: firmLaborCost,
      consultantCost: firmConsultantCost,
      netProfit: firmFeesCollected - firmLaborCost - firmConsultantCost,
    },
  };
}

export async function getTimesheetData(userId: number, weekStart: Date) {
  const db = await getDb();
  if (!db) return { entries: [] as any[], dailyTotals: {} as Record<string, number>, weekTotal: 0 };
  
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  const entries = await db.select().from(timeEntries).where(and(
    eq(timeEntries.userId, userId),
    gte(timeEntries.startTime, weekStart),
    lte(timeEntries.startTime, weekEnd),
    sql`${timeEntries.endTime} IS NOT NULL`
  )).orderBy(asc(timeEntries.startTime));
  
  const allProjects = await db.select().from(projects);
  const allTasks = await db.select().from(tasks);
  
  const dailyTotals: Record<string, number> = {};
  let weekTotal = 0;
  
  const enrichedEntries = entries.map(e => {
    const dayKey = e.startTime.toISOString().split('T')[0];
    dailyTotals[dayKey] = (dailyTotals[dayKey] || 0) + e.durationMinutes;
    weekTotal += e.durationMinutes;
    
    const project = allProjects.find(p => p.id === e.projectId);
    const task = e.taskId ? allTasks.find(t => t.id === e.taskId) : undefined;
    
    return {
      ...e,
      projectName: project?.name || 'Unknown',
      taskTitle: task?.title || undefined,
    };
  });
  
  return { entries: enrichedEntries, dailyTotals, weekTotal };
}

export async function seedDemoData() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if data already exists
  const existingProjects = await db.select({ count: sql<number>`count(*)` }).from(projects);
  if (Number(existingProjects[0]?.count) > 0) return { seeded: false, message: "Data already exists" };

  // Seed team members
  const memberColors = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444"];
  const memberData: InsertTeamMember[] = [
    { name: "Sarah Chen", email: "sarah@studio.com", title: "Principal Architect", avatarColor: memberColors[0], billingRate: 28500, weeklyCapacityHours: 40 },
    { name: "Marcus Rivera", email: "marcus@studio.com", title: "Senior Designer", avatarColor: memberColors[1], billingRate: 22000, weeklyCapacityHours: 40 },
    { name: "Emily Park", email: "emily@studio.com", title: "Project Architect", avatarColor: memberColors[2], billingRate: 19500, weeklyCapacityHours: 40 },
    { name: "James Wilson", email: "james@studio.com", title: "Design Lead", avatarColor: memberColors[3], billingRate: 24000, weeklyCapacityHours: 40 },
    { name: "Aisha Patel", email: "aisha@studio.com", title: "Junior Architect", avatarColor: memberColors[4], billingRate: 14000, weeklyCapacityHours: 40 },
    { name: "David Kim", email: "david@studio.com", title: "Intern Architect", avatarColor: memberColors[5], billingRate: 9500, weeklyCapacityHours: 40 },
  ];
  for (const m of memberData) await db.insert(teamMembers).values(m);

  const members = await db.select().from(teamMembers);

  // Seed projects
  const now = new Date();
  const projectData: InsertProject[] = [
    { name: "Riverside Cultural Center", clientName: "City of Portland", address: "450 NW Waterfront Dr, Portland, OR", projectManagerId: members[0]?.id, status: "on_track", phase: "construction_documents", completionPercentage: 68, startDate: new Date(now.getTime() - 120 * 86400000), deadline: new Date(now.getTime() + 90 * 86400000), billing25: true, billing50: true, billing75: false, billing100: false, billingOk: true, description: "A 45,000 sq ft cultural center featuring exhibition galleries, performance spaces, and community rooms with river-facing terraces.", contractedFee: 285000000, invoicedAmount: 142500000 },
    { name: "Meridian Tower Residences", clientName: "Apex Development Group", address: "1200 S Michigan Ave, Chicago, IL", projectManagerId: members[2]?.id, status: "on_track", phase: "design_development", completionPercentage: 42, startDate: new Date(now.getTime() - 60 * 86400000), deadline: new Date(now.getTime() + 180 * 86400000), billing25: true, billing50: false, billing75: false, billing100: false, billingOk: true, description: "A 32-story luxury residential tower with ground-floor retail, rooftop amenities, and a distinctive crystalline facade.", contractedFee: 520000000, invoicedAmount: 130000000 },
    { name: "Greenleaf Elementary Renovation", clientName: "Unified School District", address: "789 Oak Street, Sacramento, CA", projectManagerId: members[0]?.id, status: "delayed", phase: "construction_administration", completionPercentage: 82, startDate: new Date(now.getTime() - 200 * 86400000), deadline: new Date(now.getTime() + 30 * 86400000), billing25: true, billing50: true, billing75: true, billing100: false, billingOk: false, description: "Complete renovation of a 1960s elementary school including seismic retrofitting, new HVAC, and modernized learning spaces." },
    { name: "Harbor View Office Complex", clientName: "Maritime Holdings LLC", address: "2100 Harbor Blvd, San Diego, CA", projectManagerId: members[3]?.id, status: "on_hold", phase: "schematic_design", completionPercentage: 18, startDate: new Date(now.getTime() - 30 * 86400000), deadline: new Date(now.getTime() + 300 * 86400000), billing25: false, billing50: false, billing75: false, billing100: false, billingOk: true, description: "A three-building waterfront office campus with shared courtyards, underground parking, and LEED Platinum certification target." },
    { name: "Artisan Loft Conversion", clientName: "Heritage Realty Partners", address: "55 Franklin St, Brooklyn, NY", projectManagerId: members[2]?.id, status: "on_track", phase: "bidding_negotiation", completionPercentage: 75, startDate: new Date(now.getTime() - 150 * 86400000), deadline: new Date(now.getTime() + 60 * 86400000), billing25: true, billing50: true, billing75: true, billing100: false, billingOk: true, description: "Adaptive reuse of a historic warehouse into 24 luxury loft residences preserving original timber and masonry elements." },
    { name: "Summit Medical Pavilion", clientName: "Regional Health Network", address: "3400 University Pkwy, Austin, TX", projectManagerId: members[3]?.id, status: "on_track", phase: "schematic_design", completionPercentage: 25, startDate: new Date(now.getTime() - 45 * 86400000), deadline: new Date(now.getTime() + 240 * 86400000), billing25: true, billing50: false, billing75: false, billing100: false, billingOk: true, description: "A 60,000 sq ft outpatient medical pavilion with imaging center, surgical suites, and healing garden." },
    { name: "Cascade Winery Estate", clientName: "Cascade Vineyards Inc", address: "1800 Vineyard Rd, Napa, CA", projectManagerId: members[0]?.id, status: "on_track", phase: "pre_design", completionPercentage: 8, startDate: new Date(now.getTime() - 10 * 86400000), deadline: new Date(now.getTime() + 365 * 86400000), billing25: false, billing50: false, billing75: false, billing100: false, billingOk: true, description: "A boutique winery with tasting room, barrel cave, event pavilion, and guest cottages nestled in the hillside." },
    { name: "Metro Transit Hub", clientName: "Metro Transit Authority", address: "100 Central Station, Denver, CO", projectManagerId: members[2]?.id, status: "completed", phase: "post_occupancy", completionPercentage: 100, startDate: new Date(now.getTime() - 400 * 86400000), deadline: new Date(now.getTime() - 30 * 86400000), billing25: true, billing50: true, billing75: true, billing100: true, billingOk: true, description: "A multimodal transit hub connecting light rail, bus rapid transit, and bicycle infrastructure with retail concourse." },
  ];
  for (const p of projectData) await db.insert(projects).values(p);

  const allProjects = await db.select().from(projects);

  // Seed invoices for demo projects
  const invoiceData: InsertInvoice[] = [
    { projectId: allProjects[0]!.id, amount: 71250000, description: "25% Schematic Design milestone", invoiceNumber: "INV-2025-001", status: "paid", invoiceDate: new Date(now.getTime() - 90 * 86400000), paidDate: new Date(now.getTime() - 75 * 86400000) },
    { projectId: allProjects[0]!.id, amount: 71250000, description: "50% Design Development milestone", invoiceNumber: "INV-2025-002", status: "paid", invoiceDate: new Date(now.getTime() - 45 * 86400000), paidDate: new Date(now.getTime() - 30 * 86400000) },
    { projectId: allProjects[0]!.id, amount: 71250000, description: "75% Construction Documents milestone", invoiceNumber: "INV-2025-003", status: "sent", invoiceDate: new Date(now.getTime() - 5 * 86400000), dueDate: new Date(now.getTime() + 25 * 86400000) },
    { projectId: allProjects[1]!.id, amount: 130000000, description: "25% Schematic Design milestone", invoiceNumber: "INV-2025-004", status: "paid", invoiceDate: new Date(now.getTime() - 30 * 86400000), paidDate: new Date(now.getTime() - 15 * 86400000) },
    { projectId: allProjects[1]!.id, amount: 130000000, description: "50% Design Development milestone", invoiceNumber: "INV-2025-005", status: "draft", invoiceDate: new Date(now.getTime()) },
    { projectId: allProjects[4]!.id, amount: 56250000, description: "25% milestone", invoiceNumber: "INV-2025-006", status: "paid", invoiceDate: new Date(now.getTime() - 100 * 86400000), paidDate: new Date(now.getTime() - 85 * 86400000) },
    { projectId: allProjects[4]!.id, amount: 56250000, description: "50% milestone", invoiceNumber: "INV-2025-007", status: "paid", invoiceDate: new Date(now.getTime() - 60 * 86400000), paidDate: new Date(now.getTime() - 45 * 86400000) },
    { projectId: allProjects[4]!.id, amount: 56250000, description: "75% milestone", invoiceNumber: "INV-2025-008", status: "sent", invoiceDate: new Date(now.getTime() - 10 * 86400000), dueDate: new Date(now.getTime() + 20 * 86400000) },
  ];
  for (const inv of invoiceData) await db.insert(invoices).values(inv);

  // Seed tasks
  const taskData: InsertTask[] = [
    // Riverside Cultural Center tasks
    { projectId: allProjects[0]!.id, assigneeId: members[0]?.id, title: "Finalize structural engineering coordination", status: "in_progress", priority: 3, sortOrder: 0, deadline: new Date(now.getTime() + 14 * 86400000) },
    { projectId: allProjects[0]!.id, assigneeId: members[1]?.id, title: "Complete MEP clash detection review", status: "todo", priority: 5, sortOrder: 1, deadline: new Date(now.getTime() + 21 * 86400000) },
    { projectId: allProjects[0]!.id, assigneeId: members[4]?.id, title: "Update curtain wall detail drawings", status: "in_progress", priority: 7, sortOrder: 2, deadline: new Date(now.getTime() + 10 * 86400000) },
    { projectId: allProjects[0]!.id, assigneeId: members[0]?.id, title: "Submit ADA compliance documentation", status: "todo", priority: 2, sortOrder: 3, deadline: new Date(now.getTime() + 7 * 86400000) },
    { projectId: allProjects[0]!.id, assigneeId: members[5]?.id, title: "Prepare material specification schedule", status: "done", priority: 8, sortOrder: 4, completedAt: new Date(now.getTime() - 3 * 86400000) },
    // Meridian Tower tasks
    { projectId: allProjects[1]!.id, assigneeId: members[2]?.id, title: "Develop facade system alternatives study", status: "in_progress", priority: 4, sortOrder: 0, deadline: new Date(now.getTime() + 28 * 86400000) },
    { projectId: allProjects[1]!.id, assigneeId: members[1]?.id, title: "Complete unit type floor plan layouts", status: "todo", priority: 6, sortOrder: 1, deadline: new Date(now.getTime() + 35 * 86400000) },
    { projectId: allProjects[1]!.id, assigneeId: members[3]?.id, title: "Coordinate with landscape architect", status: "todo", priority: 12, sortOrder: 2, deadline: new Date(now.getTime() + 42 * 86400000) },
    // Greenleaf Elementary tasks (some overdue)
    { projectId: allProjects[2]!.id, assigneeId: members[0]?.id, title: "Review contractor RFI responses", status: "overdue", priority: 1, sortOrder: 0, deadline: new Date(now.getTime() - 5 * 86400000) },
    { projectId: allProjects[2]!.id, assigneeId: members[4]?.id, title: "Process change order #14 — seismic bracing", status: "overdue", priority: 2, sortOrder: 1, deadline: new Date(now.getTime() - 2 * 86400000) },
    { projectId: allProjects[2]!.id, assigneeId: members[2]?.id, title: "Conduct site observation visit", status: "in_progress", priority: 3, sortOrder: 2, deadline: new Date(now.getTime() + 3 * 86400000) },
    // Harbor View tasks
    { projectId: allProjects[3]!.id, assigneeId: members[3]?.id, title: "Prepare massing study options", status: "todo", priority: 5, sortOrder: 0, deadline: new Date(now.getTime() + 60 * 86400000) },
    { projectId: allProjects[3]!.id, assigneeId: members[1]?.id, title: "Research waterfront zoning requirements", status: "done", priority: 4, sortOrder: 1, completedAt: new Date(now.getTime() - 10 * 86400000) },
    // Artisan Loft tasks
    { projectId: allProjects[4]!.id, assigneeId: members[2]?.id, title: "Prepare bid package documentation", status: "in_progress", priority: 2, sortOrder: 0, deadline: new Date(now.getTime() + 14 * 86400000) },
    { projectId: allProjects[4]!.id, assigneeId: members[4]?.id, title: "Review historic preservation compliance", status: "todo", priority: 6, sortOrder: 1, deadline: new Date(now.getTime() + 21 * 86400000) },
    // Summit Medical tasks
    { projectId: allProjects[5]!.id, assigneeId: members[3]?.id, title: "Complete programming analysis report", status: "in_progress", priority: 3, sortOrder: 0, deadline: new Date(now.getTime() + 30 * 86400000) },
    { projectId: allProjects[5]!.id, assigneeId: members[5]?.id, title: "Develop site analysis diagrams", status: "todo", priority: 8, sortOrder: 1, deadline: new Date(now.getTime() + 45 * 86400000) },
    // Cascade Winery tasks
    { projectId: allProjects[6]!.id, assigneeId: members[0]?.id, title: "Conduct initial site survey and analysis", status: "todo", priority: 5, sortOrder: 0, deadline: new Date(now.getTime() + 30 * 86400000) },
    { projectId: allProjects[6]!.id, assigneeId: members[1]?.id, title: "Research local building codes and regulations", status: "todo", priority: 7, sortOrder: 1, deadline: new Date(now.getTime() + 45 * 86400000) },
  ];
  for (const t of taskData) await db.insert(tasks).values(t);

  // Seed notifications
  const notifData: InsertNotification[] = [
    { type: "task_overdue", title: "Overdue: Review contractor RFI responses", message: "Task on Greenleaf Elementary Renovation is 5 days past deadline.", relatedProjectId: allProjects[2]?.id },
    { type: "task_overdue", title: "Overdue: Process change order #14", message: "Task on Greenleaf Elementary Renovation is 2 days past deadline.", relatedProjectId: allProjects[2]?.id },
    { type: "deadline_approaching", title: "Deadline approaching: Riverside Cultural Center", message: "ADA compliance documentation is due in 7 days.", relatedProjectId: allProjects[0]?.id },
    { type: "status_change", title: "Project status changed to Delayed", message: "Greenleaf Elementary Renovation has been marked as Delayed.", relatedProjectId: allProjects[2]?.id },
    { type: "general", title: "Welcome to studioTrac", message: "Your architectural project management workspace is ready. Start by reviewing your active projects." },
  ];
  for (const n of notifData) await db.insert(notifications).values(n);

  // Seed notes
  const noteData: InsertProjectNote[] = [
    { projectId: allProjects[0]!.id, content: "Client requested additional gallery space on Level 2. Need to coordinate with structural engineer for revised beam layout.", isClientVisible: false },
    { projectId: allProjects[0]!.id, content: "River terrace design approved by planning commission. Proceeding with detailed construction documents.", isClientVisible: true },
    { projectId: allProjects[2]!.id, content: "Contractor flagged unexpected asbestos in east wing ceiling tiles. Abatement will add 2-3 weeks to schedule.", isClientVisible: false },
    { projectId: allProjects[2]!.id, content: "School board meeting scheduled for May 15 to review progress. Prepare updated renderings.", isClientVisible: true },
    { projectId: allProjects[4]!.id, content: "Historic preservation board approved facade restoration plan with minor conditions. See attached letter.", isClientVisible: true },
  ];
  for (const n of noteData) await db.insert(projectNotes).values(n);

  // Seed consultant contracts
  const consultantData: InsertConsultantContract[] = [
    { projectId: allProjects[0]!.id, name: "Thornton Engineering", discipline: "Structural Engineer", contractAmount: 42000000, status: "active", notes: "Full structural design and CA services" },
    { projectId: allProjects[0]!.id, name: "Arup MEP", discipline: "MEP Engineer", contractAmount: 38000000, status: "active", notes: "Mechanical, electrical, plumbing design" },
    { projectId: allProjects[0]!.id, name: "Olin Studio", discipline: "Landscape Architect", contractAmount: 18000000, status: "active", notes: "River terrace and site landscape" },
    { projectId: allProjects[1]!.id, name: "DeSimone Consulting", discipline: "Structural Engineer", contractAmount: 65000000, status: "active", notes: "High-rise structural system" },
    { projectId: allProjects[1]!.id, name: "WSP Group", discipline: "MEP Engineer", contractAmount: 52000000, status: "active" },
    { projectId: allProjects[1]!.id, name: "Front Inc", discipline: "Facade Consultant", contractAmount: 28000000, status: "pending", notes: "Crystalline facade engineering" },
    { projectId: allProjects[2]!.id, name: "Miyamoto International", discipline: "Structural Engineer", contractAmount: 22000000, status: "completed", notes: "Seismic retrofit design" },
    { projectId: allProjects[4]!.id, name: "Silman Associates", discipline: "Structural Engineer", contractAmount: 15000000, status: "active", notes: "Historic structure assessment" },
    { projectId: allProjects[5]!.id, name: "BR+A Consulting", discipline: "MEP Engineer", contractAmount: 35000000, status: "active", notes: "Medical-grade HVAC and systems" },
  ];
  for (const c of consultantData) await db.insert(consultantContracts).values(c);

  const allConsultants = await db.select().from(consultantContracts);

  // Seed consultant payments
  const paymentData: InsertConsultantPayment[] = [
    { consultantId: allConsultants[0]!.id, amount: 10500000, paymentDate: new Date(now.getTime() - 90 * 86400000), notes: "25% milestone - SD completion" },
    { consultantId: allConsultants[0]!.id, amount: 10500000, paymentDate: new Date(now.getTime() - 45 * 86400000), notes: "50% milestone - DD completion" },
    { consultantId: allConsultants[1]!.id, amount: 9500000, paymentDate: new Date(now.getTime() - 85 * 86400000), notes: "25% milestone" },
    { consultantId: allConsultants[1]!.id, amount: 9500000, paymentDate: new Date(now.getTime() - 40 * 86400000), notes: "50% milestone" },
    { consultantId: allConsultants[2]!.id, amount: 9000000, paymentDate: new Date(now.getTime() - 60 * 86400000), notes: "50% milestone - planting plan" },
    { consultantId: allConsultants[3]!.id, amount: 16250000, paymentDate: new Date(now.getTime() - 30 * 86400000), notes: "25% milestone - foundation design" },
    { consultantId: allConsultants[4]!.id, amount: 13000000, paymentDate: new Date(now.getTime() - 25 * 86400000), notes: "25% milestone" },
    { consultantId: allConsultants[6]!.id, amount: 11000000, paymentDate: new Date(now.getTime() - 120 * 86400000), notes: "50% milestone" },
    { consultantId: allConsultants[6]!.id, amount: 11000000, paymentDate: new Date(now.getTime() - 60 * 86400000), notes: "100% milestone - final" },
  ];
  for (const p of paymentData) await db.insert(consultantPayments).values(p);

  // Update projects with estimated hours
  const estimatedHoursMap: Record<number, number> = {
    0: 1200, 1: 2400, 2: 800, 3: 1600, 4: 600, 5: 1000, 6: 1500, 7: 900,
  };
  for (let i = 0; i < allProjects.length; i++) {
    if (estimatedHoursMap[i] !== undefined) {
      await db.update(projects).set({ estimatedHours: estimatedHoursMap[i] }).where(eq(projects.id, allProjects[i]!.id));
    }
  }

  // Seed time entries
  const timeData: InsertTimeEntry[] = [];
  const phases = ['schematic_design', 'design_development', 'construction_documents', 'construction_administration', 'pre_design', 'bidding_negotiation'] as const;
  
  // Generate realistic time entries for the past 30 days
  for (let dayOffset = 30; dayOffset >= 0; dayOffset--) {
    const day = new Date(now.getTime() - dayOffset * 86400000);
    const dayOfWeek = day.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip weekends
    
    // Each team member logs 2-4 entries per day
    for (let mi = 0; mi < Math.min(members.length, 6); mi++) {
      const member = members[mi]!;
      const entriesPerDay = 2 + (mi % 3);
      for (let ei = 0; ei < entriesPerDay; ei++) {
        const projectIdx = (mi + ei + dayOffset) % allProjects.length;
        const project = allProjects[projectIdx]!;
        const startHour = 8 + ei * 2 + Math.floor(Math.random() * 2);
        const durationMins = 45 + Math.floor(Math.random() * 135); // 45-180 mins
        const startTime = new Date(day);
        startTime.setHours(startHour, Math.floor(Math.random() * 60), 0, 0);
        const endTime = new Date(startTime.getTime() + durationMins * 60000);
        
        timeData.push({
          userId: member.id,
          projectId: project.id,
          taskId: undefined,
          description: `Work on ${project.name}`,
          startTime,
          endTime,
          durationMinutes: durationMins,
          billable: Math.random() > 0.15, // 85% billable
          phase: phases[projectIdx % phases.length],
        });
      }
    }
  }
  for (const t of timeData) await db.insert(timeEntries).values(t);

  return { seeded: true, message: "Demo data seeded successfully" };
}


export async function getTeamTimeReport(startDate?: Date, endDate?: Date) {
  const db = await getDb();
  if (!db) return { rows: [] as any[], members: [] as any[], projects: [] as any[] };

  const members = await db.select().from(teamMembers).where(eq(teamMembers.isActive, true)).orderBy(asc(teamMembers.name));
  const allProjects = await db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.name));

  const conditions = [sql`${timeEntries.endTime} IS NOT NULL`];
  if (startDate) conditions.push(gte(timeEntries.startTime, startDate));
  if (endDate) conditions.push(lte(timeEntries.startTime, endDate));
  const entries = await db.select().from(timeEntries).where(and(...conditions));

  // Build a member -> project -> hours map
  const rows = members.map(m => {
    const memberEntries = entries.filter(e => e.userId === m.id);
    const totalMinutes = memberEntries.reduce((s, e) => s + e.durationMinutes, 0);
    const billableMinutes = memberEntries.filter(e => e.billable).reduce((s, e) => s + e.durationMinutes, 0);

    const projectBreakdown: Record<number, { total: number; billable: number }> = {};
    for (const e of memberEntries) {
      if (!projectBreakdown[e.projectId]) projectBreakdown[e.projectId] = { total: 0, billable: 0 };
      projectBreakdown[e.projectId].total += e.durationMinutes;
      if (e.billable) projectBreakdown[e.projectId].billable += e.durationMinutes;
    }

    return {
      memberId: m.id,
      memberName: m.name,
      title: m.title,
      billingRate: m.billingRate,
      totalHours: Math.round(totalMinutes / 60 * 100) / 100,
      billableHours: Math.round(billableMinutes / 60 * 100) / 100,
      laborCost: Math.round((totalMinutes / 60) * m.billingRate),
      projectBreakdown: Object.entries(projectBreakdown).map(([pid, data]) => ({
        projectId: parseInt(pid),
        totalHours: Math.round(data.total / 60 * 100) / 100,
        billableHours: Math.round(data.billable / 60 * 100) / 100,
      })),
    };
  });

  return {
    rows,
    members: members.map(m => ({ id: m.id, name: m.name })),
    projects: allProjects,
  };
}
