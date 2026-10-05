/**
 * Mod bridge protocol v1 (JSON over WebSocket, one object per text frame).
 * Documented in docs/bridge-protocol.md — keep both in sync.
 */
import { z } from 'zod';

export const BRIDGE_PROTOCOL_VERSION = 1;

const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\w.-]+$/);

export const BridgeParamSchema = z.object({
  type: z.enum(['string', 'int', 'number', 'bool']).default('string'),
  label: z.string().max(80).optional(),
  default: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const BridgeEffectDeclSchema = z.object({
  id,
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  params: z.record(id, BridgeParamSchema).default({}),
});
export type BridgeEffectDecl = z.infer<typeof BridgeEffectDeclSchema>;

export const ModToAppSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocol: z.literal(BRIDGE_PROTOCOL_VERSION),
    token: z.string().max(200),
    mod: z.object({ id, name: z.string().min(1).max(80), version: z.string().max(40).optional() }),
    effects: z.array(BridgeEffectDeclSchema).max(200).default([]),
  }),
  z.object({
    type: z.literal('result'),
    id: z.string().max(64),
    status: z.enum(['ok', 'error', 'busy']),
    message: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal('subscribe'),
    events: z.array(z.enum(['gift', 'like', 'follow', 'share', 'chat', 'subscribe', 'viewerCount'])).max(10),
  }),
  z.object({ type: z.literal('ping') }),
]);
export type ModToApp = z.infer<typeof ModToAppSchema>;

export type AppToMod =
  | { type: 'welcome'; protocol: number; sessionId: string }
  | { type: 'error'; message: string }
  | {
      type: 'effect';
      id: string;
      effect: string;
      params: Record<string, unknown>;
      context: Record<string, unknown>;
    }
  | { type: 'event'; event: unknown }
  | { type: 'pong' };
