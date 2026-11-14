import { z } from 'zod';

export const createTaskSchema = z.object({ description: z.string().trim().min(1).max(4000).refine((text) => !text.includes('\0'), 'Task descriptions cannot contain NUL') }).strict();
export const taskSchema = z.object({
  id: z.uuid(),
  clanId: z.uuid(),
  description: z.string(),
  status: z.enum(['open', 'claimed', 'completed']),
  ownerId: z.uuid().nullable(),
  ownerAgentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const tasksSchema = z.object({ tasks: z.array(taskSchema) });
export type Task = z.infer<typeof taskSchema>;
