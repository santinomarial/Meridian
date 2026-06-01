# Meridian Server

NestJS backend for the Meridian collaborative browser IDE.

## Local setup

### Prerequisites

- Node.js 22+
- Docker (for PostgreSQL and Redis)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file
cp .env.example .env
# Edit .env and set JWT_SECRET to a random string of 16+ characters

# 3. Start PostgreSQL and Redis
npm run infra:up

# 4. Run database migrations
npm run db:migrate

# 5. Start the dev server
npm run start:dev
```

The server listens on http://localhost:3000 by default.
Verify it is running: `GET http://localhost:3000/health`

## Useful commands

| Command | Description |
|---|---|
| `npm run start:dev` | Start with watch mode |
| `npm run start:prod` | Start compiled output |
| `npm run build` | Compile TypeScript |
| `npm run db:generate` | Regenerate Prisma client after schema changes |
| `npm run db:migrate` | Create and apply a new migration |
| `npm run db:studio` | Open Prisma Studio |
| `npm run infra:up` | Start Docker services (postgres, redis) |
| `npm run infra:down` | Stop Docker services |
| `npm test` | Run unit tests |
