import { z } from 'zod';

export const chatTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine((text) => !text.includes('\0'));
export const sendChatSchema = z.object({ text: chatTextSchema }).strict();
export const chatQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const chatMessageSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  author: z.string(),
  authorId: z.uuid(),
  agentId: z.uuid().nullable(),
  text: z.string(),
  createdAt: z.iso.datetime(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatMessagesSchema = z.object({ messages: z.array(chatMessageSchema) });
