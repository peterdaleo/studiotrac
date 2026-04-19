# studioTrac

A full-featured architecture studio management platform built with React, Express, tRPC, and Drizzle ORM.

## Features

- **Project Management** — Track projects with phases, budgets, timelines, and billing milestones
- **Team Management** — Manage team members, roles, workload distribution, and billing rates
- **Time Tracking** — Log time entries, run timers, view timesheets, and export CSV reports
- **Financial Dashboard** — Studio profitability, net income, burn rate, and per-project P&L
- **Client Portal** — Share project progress with clients via secure token links
- **Gantt Timeline** — Visual project timeline with phase tracking
- **Consultant Contracts** — Track external consultant contracts and payments
- **Reports & Analytics** — Firm utilization, team time reports, and deadline alerts
- **Role-Based Access** — Admin and Staff roles with "Preview as Staff" toggle for admins

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS 4, shadcn/ui, Recharts |
| Backend | Express 4, tRPC 11, Superjson |
| Database | MySQL / TiDB (via Drizzle ORM) |
| Auth | Email/password with bcrypt + JWT sessions |
| File Storage | Local filesystem (Railway volume or server disk) |

## Prerequisites

- **Node.js** 20+ and **pnpm** 9+
- **MySQL** 8+ or **TiDB** database

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | MySQL connection string (e.g., `mysql://user:pass@host:port/dbname?ssl={"rejectUnauthorized":true}`) |
| `JWT_SECRET` | Yes | Secret key for signing JWT session tokens (use a random 32+ character string) |
| `RESEND_API_KEY` | No | Resend API key used to deliver invitation emails from `invites@studiotrac.app` |
| `PORT` | No | Server port (defaults to `3000`) |
| `UPLOAD_DIR` | No | Directory for file uploads (defaults to `./uploads`) |
| `NODE_ENV` | No | Set to `production` for production builds |

## Local Development

```bash
# Install dependencies
pnpm install

# Create a .env file
cat > .env << EOF
DATABASE_URL=mysql://root:password@localhost:3306/studiotrac
JWT_SECRET=change-me
RESEND_API_KEY=re_placeholder
PORT=3000
EOF

# Run database migrations (see Database Setup below)

# Start development server (with hot reload)
pnpm dev
```

The app will be available at `http://localhost:3000`.

## Database Setup

This project uses Drizzle ORM with MySQL. Migration SQL files are in the `drizzle/` directory.

1. Create a MySQL database:
   ```sql
   CREATE DATABASE studiotrac;
   ```

2. Apply migrations in order. The migration files are numbered sequentially in `drizzle/`:
   ```
   drizzle/0000_friendly_captain_stacy.sql
   drizzle/0001_...sql
   drizzle/0002_...sql
   ...
   ```

   Run each `.sql` file against your database in order:
   ```bash
   mysql -u root -p studiotrac < drizzle/0000_friendly_captain_stacy.sql
   mysql -u root -p studiotrac < drizzle/0001_*.sql
   # ... continue for all migration files
   ```

3. After applying migrations, add the `passwordHash` column if it doesn't exist:
   ```sql
   ALTER TABLE users ADD COLUMN passwordHash varchar(255) DEFAULT NULL;
   ```

## Production Build

```bash
# Build for production
pnpm build

# Start production server
NODE_ENV=production node dist/index.js
```

## Railway Deployment

### Quick Deploy

1. Push this repository to GitHub
2. Go to [railway.app](https://railway.app) and create a new project
3. Select **"Deploy from GitHub repo"** and connect your repository
4. Add a **MySQL** service from the Railway dashboard (or use an external MySQL/TiDB database)

### Configure Environment Variables

In the Railway dashboard, go to your service's **Variables** tab and add:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Your MySQL connection string (Railway provides this automatically if you add a MySQL service — use the `MYSQL_URL` reference variable) |
| `JWT_SECRET` | A random 32+ character string (generate with `openssl rand -hex 32`) |
| `PORT` | `3000` (or let Railway assign automatically) |
| `NODE_ENV` | `production` |
| `UPLOAD_DIR` | `/app/uploads` (or mount a Railway volume for persistent storage) |

### Build & Start Commands

Railway should auto-detect these from `package.json`, but you can set them explicitly:

- **Build Command:** `pnpm install && pnpm build`
- **Start Command:** `NODE_ENV=production node dist/index.js`

### Persistent File Storage (Optional)

If you need uploaded files to persist across deployments:

1. In Railway, go to your service settings
2. Add a **Volume** mount
3. Set the mount path to `/app/uploads`
4. Set `UPLOAD_DIR=/app/uploads` in your environment variables

Without a volume, uploaded files will be lost on each deployment.

### Database Migrations on Railway

After deploying, connect to your Railway MySQL instance and run the migration SQL files. You can use Railway's built-in database client or connect via CLI:

```bash
# Using Railway CLI
railway connect mysql
# Then paste the SQL from each migration file
```

### First User Setup

1. Visit your deployed app and click **Sign Up** to create the first account
2. The first user will have the default `user` role
3. To make yourself an admin, connect to the database and run:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
   ```
4. Refresh the app — you'll now have full admin access

## Project Structure

```
client/
  src/
    pages/          ← Page components (Home, Projects, Team, etc.)
    components/     ← Reusable UI components (DashboardLayout, etc.)
    contexts/       ← React contexts (Theme, StaffPreview)
    hooks/          ← Custom hooks
    lib/trpc.ts     ← tRPC client binding
    App.tsx         ← Routes & layout
    main.tsx        ← Providers & error handling
    index.css       ← Global styles & theme
drizzle/
  schema.ts         ← Database tables & types
  *.sql             ← Migration files
server/
  _core/            ← Framework plumbing (auth, context, server bootstrap)
  db.ts             ← Database query helpers
  routers.ts        ← tRPC procedures
  storage.ts        ← Local file storage helpers
shared/             ← Shared constants & types
```

## Authentication

The app uses email/password authentication with bcrypt password hashing and JWT session tokens stored in HTTP-only cookies.

- **Sign up:** `POST /api/auth/signup` with `{ email, password, name }`
- **Login:** `POST /api/auth/login` with `{ email, password }`
- **Session:** JWT cookie (`studiotrac_session`) valid for 1 year
- **Auth state:** `trpc.auth.me.useQuery()` returns the current user or `null`

## License

Private — All rights reserved.
