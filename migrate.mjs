import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const DB_URL = 'mysql://root:HXecGJWYANGehTlEeJyOjIUpMtzCWMPR@yamabiko.proxy.rlwy.net:28988/railway';
const ORG_ID = 1;
const PETER_USER_ID = 1;

const projects = JSON.parse(readFileSync('/home/ubuntu/studiotrac/studiotrac_projects.json', 'utf8'));

// Map old Firestore status -> new enum
function mapStatus(s) {
  if (!s) return 'on_track';
  const lower = s.toLowerCase();
  if (lower.includes('complete')) return 'completed';
  if (lower.includes('hold')) return 'on_hold';
  if (lower.includes('delay')) return 'delayed';
  return 'on_track';
}

// Map old Firestore phase -> new enum
function mapPhase(p) {
  if (!p) return 'pre_design';
  const lower = p.toLowerCase().replace(/\s+/g, '_');
  const map = {
    'project_signed': 'pre_design',
    'planning': 'pre_design',
    'schematic_design': 'schematic_design',
    'design_development': 'design_development',
    'construction_drawings': 'construction_documents',
    'construction_documents': 'construction_documents',
    'bidding': 'bidding_negotiation',
    'review': 'construction_documents',
    'construction': 'construction_administration',
  };
  return map[lower] || 'pre_design';
}

// Parse a date string safely
function parseDate(d) {
  if (!d) return null;
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return null;
  }
}

// Map task status
function mapTaskStatus(completed) {
  return completed ? 'done' : 'todo';
}

// Collect all unique team member names
const allTeamNames = new Set();
projects.forEach(p => (p.team || []).forEach(t => {
  if (t.name) allTeamNames.add(t.name.trim());
}));
// Also from tasks
projects.forEach(p => (p.tasks || []).forEach(t => {
  if (t.assignedTo) allTeamNames.add(t.assignedTo.trim());
}));

// Avatar colors for team members
const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6', '#f97316', '#84cc16'];

async function run() {
  const conn = await mysql.createConnection(DB_URL);
  console.log('Connected to Railway MySQL');

  // 1. Insert team members (deduplicated by name)
  console.log(`\nInserting ${allTeamNames.size} team members...`);
  const teamMemberIdMap = {}; // name -> id

  let colorIdx = 0;
  for (const name of allTeamNames) {
    // Skip "Peter" since Peter is already a user (id=1)
    const [existing] = await conn.execute(
      'SELECT id FROM team_members WHERE name = ? AND organizationId = ?',
      [name, ORG_ID]
    );
    if (existing.length > 0) {
      teamMemberIdMap[name] = existing[0].id;
      console.log(`  Team member already exists: ${name} (id=${existing[0].id})`);
      continue;
    }

    // Determine title from roles seen in projects
    const roles = new Set();
    projects.forEach(p => (p.team || []).forEach(t => {
      if (t.name?.trim() === name) roles.add(t.role);
    }));
    const title = [...roles].join(', ') || null;

    const [result] = await conn.execute(
      `INSERT INTO team_members (name, title, avatarColor, isActive, billingRate, weeklyCapacityHours, organizationId)
       VALUES (?, ?, ?, 1, 0, 40, ?)`,
      [name, title, COLORS[colorIdx % COLORS.length], ORG_ID]
    );
    teamMemberIdMap[name] = result.insertId;
    console.log(`  Inserted team member: ${name} (id=${result.insertId})`);
    colorIdx++;
  }

  // 2. Insert projects
  console.log(`\nInserting ${projects.length} projects...`);
  const projectIdMap = {}; // firestore id -> mysql id

  for (const p of projects) {
    const status = mapStatus(p.status);
    const phase = mapPhase(p.phase);
    const deadline = parseDate(p.deadline);
    const completedAt = parseDate(p.completedAt);
    const billing = p.billing || {};

    const [result] = await conn.execute(
      `INSERT INTO projects 
       (name, clientName, address, status, phase, completionPercentage, deadline,
        billing25, billing50, billing75, billing100,
        description, estimatedHours, contractedFee, invoicedAmount,
        organizationId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        p.name || 'Untitled Project',
        p.client || null,
        p.address || null,
        status,
        phase,
        p.percentageComplete || 0,
        deadline,
        billing['25'] ? 1 : 0,
        billing['50'] ? 1 : 0,
        billing['75'] ? 1 : 0,
        billing['100'] ? 1 : 0,
        p.notes || p.clientNotes || null,
        p.totalHours || 0,
        0, // contractedFee
        0, // invoicedAmount
        ORG_ID,
      ]
    );
    projectIdMap[p.id] = result.insertId;
    process.stdout.write('.');
  }
  console.log(`\n  Inserted ${projects.length} projects`);

  // 3. Insert tasks (embedded in projects)
  console.log('\nInserting tasks...');
  let taskCount = 0;
  for (const p of projects) {
    const projectId = projectIdMap[p.id];
    if (!projectId) continue;
    for (const task of (p.tasks || [])) {
      const assigneeName = task.assignedTo?.trim();
      const assigneeId = assigneeName ? (teamMemberIdMap[assigneeName] || null) : null;
      const taskStatus = mapTaskStatus(task.completed);
      const taskDeadline = parseDate(task.deadline);
      const taskCreatedAt = parseDate(task.createdAt) || new Date().toISOString().slice(0, 19).replace('T', ' ');

      await conn.execute(
        `INSERT INTO tasks (projectId, assigneeId, title, status, deadline, organizationId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [projectId, assigneeId, task.title || 'Untitled Task', taskStatus, taskDeadline, ORG_ID, taskCreatedAt]
      );
      taskCount++;
    }
  }
  console.log(`  Inserted ${taskCount} tasks`);

  // 4. Summary
  const [projectRows] = await conn.execute('SELECT COUNT(*) as cnt FROM projects WHERE organizationId = ?', [ORG_ID]);
  const [taskRows] = await conn.execute('SELECT COUNT(*) as cnt FROM tasks WHERE organizationId = ?', [ORG_ID]);
  const [memberRows] = await conn.execute('SELECT COUNT(*) as cnt FROM team_members WHERE organizationId = ?', [ORG_ID]);

  console.log('\n=== Migration Complete ===');
  console.log(`Projects: ${projectRows[0].cnt}`);
  console.log(`Tasks: ${taskRows[0].cnt}`);
  console.log(`Team Members: ${memberRows[0].cnt}`);

  await conn.end();
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
