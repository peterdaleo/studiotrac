# studioTrac — Project TODO

## Core Infrastructure
- [x] Database schema (projects, tasks, team_members, notes, notifications)
- [x] Global theming (dark premium SaaS palette, typography, spacing)
- [x] DashboardLayout with sidebar navigation
- [x] tRPC routers for all entities (projects, tasks, team, notifications)

## Authentication
- [x] Login/signup flow via Manus OAuth
- [x] Protected routes and role-based access

## Project Dashboard
- [x] Project list with status indicators (On Track, On Hold, Delayed)
- [x] Phase display (Schematic Design, Design Development, Construction Drawings, etc.)
- [x] Completion percentage progress bars
- [x] Deadline tracking with visual indicators
- [x] Filter and search projects
- [x] Project health data visualization (charts/metrics)

## Detailed Project View
- [x] Project info (name, client, address, PM, phase, status)
- [x] Billing milestones (25%, 50%, 75%, 100%) with visual tracker
- [x] Billing OK indicator
- [x] Project-specific notes (add/edit/delete)
- [x] Project tasks list
- [x] Project timeline/phase progression

## Task Management
- [x] Create/edit/delete tasks
- [x] Assign tasks to team members
- [x] Priority levels (1-20) with visual indicators
- [x] Deadline tracking and missed task alerts
- [x] Drag-and-drop task reordering/prioritization
- [x] Task status management (Todo, In Progress, Done, Overdue)

## Team View
- [x] Team member list with workload overview
- [x] Filter projects by team member
- [x] Missed task rate per member
- [x] Assignment breakdown per member
- [x] Workload visualization (charts)

## Smart Notifications & Alerts
- [x] Approaching deadline alerts
- [x] Missed task notifications
- [x] Notification bell in header with unread count

## Calendar View
- [x] Monthly calendar showing project deadlines and milestones

## UX Enhancements
- [x] Architecture-specific terminology throughout
- [x] Premium SaaS polish (animations, micro-interactions)
- [x] Responsive design
- [x] Empty states with helpful guidance
- [x] Loading skeletons

## Seed Data & Testing
- [x] Seed demo data for projects, tasks, team members
- [x] Vitest unit tests for key procedures
- [x] End-to-end testing

## Deployment
- [x] Final checkpoint
- [x] Deploy to live URL

## Phase 2 Features

### Gantt Timeline View
- [x] Gantt data endpoint returning projects with start/end dates
- [x] Horizontal timeline page with overlapping project bars
- [x] Color-coded by status, phase labels, resource conflict indicators
- [x] Navigation link in sidebar

### File Attachments per Project
- [x] Database table for project_files (name, url, fileKey, mimeType, size, uploadedBy)
- [x] S3 file upload tRPC procedure (storagePut)
- [x] File list/download/delete tRPC procedures
- [x] File attachments section in Project Detail page with upload
- [x] File type icons and size display

### Email Notifications
- [x] Email notification preferences (opt-in per user)
- [x] Deadline approaching alerts (configurable day warnings)
- [x] Overdue task email alerts
- [x] Notification settings page with full configuration
- [x] Manual deadline check with alert generation

### Deployment
- [x] Tests for new features (35 tests passing)
- [x] Final checkpoint
- [x] Redeploy to live URL

## Phase 3 Features

### Client Portal (Public Shareable View)
- [x] Database table for client_share_tokens (projectId, token, expiresAt, isActive)
- [x] tRPC procedure to generate/revoke share links per project
- [x] Public tRPC endpoint to fetch project data by share token (no auth required)
- [x] Client Portal page (read-only): project progress, milestones, client-visible notes, shared files
- [x] Share link button in Project Detail page with copy-to-clipboard
- [x] Token expiration and revocation support

### Improved Inline Editing UX
- [x] Edit project details (dates, phase, status, PM) with clear edit buttons/inline editing
- [x] Edit task details (deadline, priority, assignee, status) with inline editing
- [x] Add Task dialog with all fields (title, assignee, priority, deadline, description)
- [x] Visual edit affordances (pencil icons, hover states, click-to-edit)
- [x] Confirmation for destructive actions (delete project/task)

### Deployment
- [x] Tests for new features (41 tests passing)
- [x] Final checkpoint
- [x] Redeploy to live URL

## Phase 4 Features

### Budget / Fee Tracking
- [x] Database columns on projects: contractedFee, invoicedAmount (decimal/int cents)
- [x] Budget invoices table: projectId, amount, description, invoiceDate, status (draft/sent/paid)
- [x] tRPC procedures for budget CRUD (create/update invoices, update contracted fee)
- [x] Budget section in Project Detail page with contracted fee, invoiced, remaining balance
- [x] Financial Overview page: summary across all projects (total contracted, total invoiced, total outstanding)
- [x] Charts for financial health (invoiced vs contracted, outstanding by project)

### CSV/PDF Export
- [x] Server-side export endpoints for project summaries, task lists, team workload
- [x] CSV generation for tabular data (projects list, tasks list, team stats)
- [x] Export buttons on Reports page and Financials page
- [x] Download handling in frontend

### Role-Based Access Control (RBAC)
- [x] Use existing user role field (admin/user) for access control
- [x] Admin-only procedures: manage billing, project settings, team assignments, delete projects
- [x] Staff restrictions: view-only on billing/financial data, admin-gated project/team CRUD
- [x] RBAC middleware in tRPC (adminProcedure) applied to project create/update/delete, team create/update/delete, invoice CRUD

### Deployment
- [x] Tests for new features (60 tests passing)
- [x] Final checkpoint
- [x] Redeploy to live URL
