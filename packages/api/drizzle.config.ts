import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/db/schema.ts', './src/db/context.ts', './src/db/tasks.ts', './src/db/chat.ts'],
  out: './drizzle',
});
