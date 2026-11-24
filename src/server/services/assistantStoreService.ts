import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AccountRole,
  AiConversationDetail,
  AiConversationSummary,
  AiMessageRecord,
  AssistantResponse,
} from '../../shared/types';
import { ServiceError } from './patientService';

export function listAiConversations(
  db: DatabaseSync,
  clinicId: string,
  userId: string
): AiConversationSummary[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.clinic_id, c.user_id, c.role, c.title, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS message_count
       FROM ai_conversations c
       WHERE c.clinic_id = ? AND c.user_id = ?
       ORDER BY c.updated_at DESC
       LIMIT 30`
    )
    .all(clinicId, userId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    clinicId: String(r.clinic_id),
    userId: String(r.user_id),
    role: r.role as AccountRole,
    title: String(r.title),
    messageCount: Number(r.message_count ?? 0),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export function createAiConversation(
  db: DatabaseSync,
  clinicId: string,
  userId: string,
  role: AccountRole,
  title = 'New Conversation'
): AiConversationSummary {
  const id = `CONV-${crypto.randomUUID().slice(0, 10)}`;
  const nowIso = new Date().toISOString();
  const safeTitle = title.trim().slice(0, 100) || 'New Conversation';

  db.prepare(`
    INSERT INTO ai_conversations (id, clinic_id, user_id, role, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, clinicId, userId, role, safeTitle, nowIso, nowIso);

  return {
    id,
    clinicId,
    userId,
    role,
    title: safeTitle,
    messageCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function getAiConversationDetail(
  db: DatabaseSync,
  clinicId: string,
  userId: string,
  conversationId: string
): AiConversationDetail {
  const conv = db
    .prepare(
      `SELECT id, clinic_id, user_id, role, title, created_at, updated_at
       FROM ai_conversations
       WHERE id = ? AND clinic_id = ? AND user_id = ?`
    )
    .get(conversationId, clinicId, userId) as Record<string, unknown> | undefined;

  if (!conv) {
    throw new ServiceError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  }

  const msgRows = db
    .prepare(
      `SELECT id, conversation_id, role, content, intent, response_json, created_at
       FROM ai_messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    )
    .all(conversationId) as Array<Record<string, unknown>>;

  const messages: AiMessageRecord[] = msgRows.map((m) => {
    let parsedResponse: AssistantResponse | null = null;
    if (typeof m.response_json === 'string' && m.response_json.trim()) {
      try {
        parsedResponse = JSON.parse(m.response_json) as AssistantResponse;
      } catch {
        parsedResponse = null;
      }
    }
    return {
      id: String(m.id),
      conversationId: String(m.conversation_id),
      role: m.role as 'user' | 'assistant',
      content: String(m.content),
      intent: String(m.intent ?? ''),
      response: parsedResponse,
      createdAt: String(m.created_at),
    };
  });

  return {
    id: String(conv.id),
    clinicId: String(conv.clinic_id),
    userId: String(conv.user_id),
    role: conv.role as AccountRole,
    title: String(conv.title),
    messageCount: messages.length,
    createdAt: String(conv.created_at),
    updatedAt: String(conv.updated_at),
    messages,
  };
}

export function appendAiMessage(
  db: DatabaseSync,
  clinicId: string,
  userId: string,
  role: AccountRole,
  input: {
    conversationId?: string;
    messageRole: 'user' | 'assistant';
    content: string;
    intent?: string;
    response?: AssistantResponse | null;
    titleHint?: string;
  }
): { conversationId: string; message: AiMessageRecord } {
  let conversationId = input.conversationId?.trim();
  const nowIso = new Date().toISOString();

  if (conversationId) {
    const owned = db
      .prepare('SELECT id FROM ai_conversations WHERE id = ? AND clinic_id = ? AND user_id = ?')
      .get(conversationId, clinicId, userId);
    if (!owned) {
      conversationId = undefined;
    }
  }

  if (!conversationId) {
    const derivedTitle = (input.titleHint ?? input.content).trim().slice(0, 72) || 'Assistant Session';
    const created = createAiConversation(db, clinicId, userId, role, derivedTitle);
    conversationId = created.id;
  } else {
    db.prepare('UPDATE ai_conversations SET updated_at = ? WHERE id = ?').run(nowIso, conversationId);
  }

  const msgId = `MSG-${crypto.randomUUID().slice(0, 12)}`;
  const responseJson = input.response ? JSON.stringify(input.response) : '';

  db.prepare(`
    INSERT INTO ai_messages (id, conversation_id, role, content, intent, response_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    msgId,
    conversationId,
    input.messageRole,
    input.content,
    input.intent ?? '',
    responseJson,
    nowIso
  );

  return {
    conversationId,
    message: {
      id: msgId,
      conversationId,
      role: input.messageRole,
      content: input.content,
      intent: input.intent ?? '',
      response: input.response ?? null,
      createdAt: nowIso,
    },
  };
}

export function deleteAiConversation(
  db: DatabaseSync,
  clinicId: string,
  userId: string,
  conversationId: string
): { deleted: boolean } {
  const existing = db
    .prepare('SELECT id FROM ai_conversations WHERE id = ? AND clinic_id = ? AND user_id = ?')
    .get(conversationId, clinicId, userId);
  if (!existing) {
    throw new ServiceError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  }
  db.prepare('DELETE FROM ai_conversations WHERE id = ? AND clinic_id = ? AND user_id = ?').run(
    conversationId,
    clinicId,
    userId
  );
  return { deleted: true };
}
