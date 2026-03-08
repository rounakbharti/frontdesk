import { z } from "zod";

// ============================================================
// Frontdesk AI — Shared Domain Types & Zod Schemas
// This is the single source of truth for all event contracts,
// entity shapes, and API payloads across all services.
// ============================================================

// ──────────────────────────────────────────────
// Enums — help request lifecycle states
// ──────────────────────────────────────────────
export const HelpRequestStatus = {
  PENDING: "pending",
  RESOLVED: "resolved",
  UNRESOLVED: "unresolved", // timed out without supervisor answer
} as const;

export type HelpRequestStatus =
  (typeof HelpRequestStatus)[keyof typeof HelpRequestStatus];

export const ResolutionSource = {
  SUPERVISOR: "supervisor",
  KB_AUTO: "kb_auto",
  TIMEOUT: "timeout",
} as const;

export type ResolutionSource =
  (typeof ResolutionSource)[keyof typeof ResolutionSource];

export const NluMode = {
  MOCK: "mock",
  LOCAL_MODEL: "local_model",
} as const;

export type NluMode = (typeof NluMode)[keyof typeof NluMode];

// ──────────────────────────────────────────────
// Entity Schemas
// ──────────────────────────────────────────────
export const CustomerSchema = z.object({
  id: z.string().uuid(),
  phone: z.string().min(7).max(20),
  name: z.string().optional(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const HelpRequestSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  call_session_id: z.string(),
  question_text: z.string().min(1),
  agent_confidence: z.number().min(0).max(1),
  agent_answer: z.string().nullable(),
  status: z.nativeEnum(HelpRequestStatus as unknown as Record<string, string>),
  assigned_supervisor_id: z.string().uuid().nullable(),
  resolution_text: z.string().nullable(),
  resolution_source: z
    .nativeEnum(ResolutionSource as unknown as Record<string, string>)
    .nullable(),
  ttl_expires_at: z.coerce.date(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  resolved_at: z.coerce.date().nullable(),
  version: z.number().int().min(0),
});
export type HelpRequest = z.infer<typeof HelpRequestSchema>;

export const KnowledgeBaseEntrySchema = z.object({
  id: z.string().uuid(),
  question_normalized: z.string().min(1),
  answer: z.string().min(1),
  source: z.string(),
  created_by: z.string().uuid().nullable(),
  created_at: z.coerce.date(),
  version: z.number().int().min(0),
  active: z.boolean(),
  source_help_request_id: z.string().uuid().nullable(),
  confidence_score: z.number().min(0).max(1).nullable(),
});
export type KnowledgeBaseEntry = z.infer<typeof KnowledgeBaseEntrySchema>;

export const AuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  action: z.string(),
  actor_id: z.string().nullable(),
  details: z.record(z.unknown()),
  created_at: z.coerce.date(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

// ──────────────────────────────────────────────
// Kafka Event Message Schemas
// ──────────────────────────────────────────────
export const KafkaEventMeta = z.object({
  event_id: z.string().uuid(),
  event_version: z.literal("1.0"),
  source_service: z.string(),
  trace_id: z.string().optional(),
  timestamp: z.string().datetime(),
});

export const HelpRequestCreatedEventSchema = z.object({
  meta: KafkaEventMeta,
  payload: z.object({
    help_request_id: z.string().uuid(),
    customer_id: z.string().uuid(),
    call_session_id: z.string(),
    question_text: z.string(),
    agent_confidence: z.number(),
    ttl_expires_at: z.string().datetime(),
  }),
});
export type HelpRequestCreatedEvent = z.infer<
  typeof HelpRequestCreatedEventSchema
>;

export const HelpRequestResolvedEventSchema = z.object({
  meta: KafkaEventMeta,
  payload: z.object({
    help_request_id: z.string().uuid(),
    resolution_text: z.string(),
    supervisor_id: z.string().uuid(),
    caller_phone: z.string(),
  }),
});
export type HelpRequestResolvedEvent = z.infer<
  typeof HelpRequestResolvedEventSchema
>;

export const HelpRequestTimedOutEventSchema = z.object({
  meta: KafkaEventMeta,
  payload: z.object({
    help_request_id: z.string().uuid(),
    customer_id: z.string().uuid(),
    reason: z.literal("supervisor_timeout"),
    expired_at: z.string().datetime(),
  }),
});
export type HelpRequestTimedOutEvent = z.infer<
  typeof HelpRequestTimedOutEventSchema
>;

export const SupervisorAnsweredEventSchema = HelpRequestResolvedEventSchema;
export type SupervisorAnsweredEvent = HelpRequestResolvedEvent;

export const KbLearnEventSchema = z.object({
  meta: KafkaEventMeta,
  payload: z.object({
    kb_candidate_id: z.string().uuid(),
    question_text: z.string(),
    answer_text: z.string(),
    source_help_request_id: z.string().uuid().nullable(),
    confidence_score: z.number().min(0).max(1).optional(),
  }),
});
export type KbLearnEvent = z.infer<typeof KbLearnEventSchema>;

export const AuditEventSchema = z.object({
  meta: KafkaEventMeta,
  payload: AuditLogEntrySchema.omit({ id: true, created_at: true }),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// ──────────────────────────────────────────────
// Kafka Topic Registry
// ──────────────────────────────────────────────
export const KafkaTopics = {
  HELP_REQUEST_CREATED: "help_request.created",
  HELP_REQUEST_RESOLVED: "help_request.resolved",
  HELP_REQUEST_TIMED_OUT: "help_request.timed_out",
  SUPERVISOR_ANSWERED: "supervisor.answered",
  KB_LEARN: "kb.learn",
  AUDIT_EVENTS: "audit.events",
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];

// ──────────────────────────────────────────────
// API Payload Schemas
// ──────────────────────────────────────────────
export const CallEventPayloadSchema = z.object({
  session_id: z.string().min(1),
  caller_id: z.string().min(7).max(20), // phone number
  transcript: z.string().min(1).max(5000),
});
export type CallEventPayload = z.infer<typeof CallEventPayloadSchema>;

export const NluQueryResponseSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()),
  mode: z.nativeEnum(NluMode as unknown as Record<string, string>),
  latency_ms: z.number().optional(),
});
export type NluQueryResponse = z.infer<typeof NluQueryResponseSchema>;

export const CreateHelpRequestBodySchema = z.object({
  customer_id: z.string().uuid(),
  call_session_id: z.string().min(1),
  question_text: z.string().min(1),
  agent_confidence: z.number().min(0).max(1),
  agent_answer: z.string().nullable().default(null),
});
export type CreateHelpRequestBody = z.infer<typeof CreateHelpRequestBodySchema>;

export const ResolveHelpRequestBodySchema = z.object({
  resolution_text: z.string().min(1),
  supervisor_id: z.string().uuid(),
});
export type ResolveHelpRequestBody = z.infer<
  typeof ResolveHelpRequestBodySchema
>;

// ──────────────────────────────────────────────
// Redis Key Helpers
// ──────────────────────────────────────────────
export const RedisKeys = {
  PENDING_HELP_REQUESTS_ZSET: "pending_help_requests",
  HELP_REQUEST_LOCK_PREFIX: "lock:help_request:",
  SESSION_CONTEXT_PREFIX: "session:",
} as const;
