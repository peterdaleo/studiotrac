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
- [ ] Final checkpoint
- [ ] Deploy to live URL
