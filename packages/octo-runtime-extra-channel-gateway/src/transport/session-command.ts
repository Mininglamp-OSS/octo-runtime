import type { ImInboundMessage } from "../contracts.js";
import type { ImMessage } from "./wukong.js";

type SessionCommand = NonNullable<ImInboundMessage["sessionControl"]>;
interface MentionEntity {
  uid: string;
  offset: number;
  length: number;
}

function exactCommand(text: string): SessionCommand | null {
  const command = text.trim();
  return command === "/reset" || command === "/new" || command === "/stop" ? command : null;
}

function splitsSurrogate(text: string, offset: number): boolean {
  const before = text.charCodeAt(offset - 1),
    after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/**
 * 在 Gateway 已完成消息准入后解析当前纯文本；不改变原文，不从名称补造授权。
 * 只有剥离原生提及前缀后的完整输入才是控制命令，含 /stop 的语义文本仍交给 AgentRun。
 */
export function sessionCommand(message: ImMessage, botId: string): SessionCommand | null {
  if (![2, 5].includes(message.channelType) || message.payload.type !== 1) return null;
  const text = message.payload.content,
    raw = message.payload.mention;
  if (typeof text !== "string" || !raw || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const mention = raw as Record<string, unknown>;
  const flag = (value: unknown): boolean => value === 1 || value === true;
  // ais 会把 Bot UID 展开到 uids；广播与直接点名混合也不能操作会话。
  if ([mention.all, mention.ais, mention.humans].some(flag) || !Array.isArray(mention.uids))
    return null;
  const uids = new Set(mention.uids);
  if (!uids.has(botId)) return null;
  if (mention.entities === undefined) return exactCommand(text);
  if (!Array.isArray(mention.entities)) return null;
  if (!mention.entities.length) return exactCommand(text);
  const entities: MentionEntity[] = [];
  for (const rawEntity of mention.entities) {
    if (!rawEntity || typeof rawEntity !== "object" || Array.isArray(rawEntity)) return null;
    const entity = rawEntity as Record<string, unknown>;
    const { uid, offset, length } = entity;
    if (
      typeof uid !== "string" ||
      !uid ||
      !uids.has(uid) ||
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length <= 1 ||
      offset + length > text.length ||
      splitsSurrogate(text, offset) ||
      splitsSurrogate(text, offset + length) ||
      text[offset] !== "@" ||
      !text.slice(offset + 1, offset + length).trim()
    )
      return null;
    entities.push({ uid, offset, length });
  }
  entities.sort((left, right) => left.offset - right.offset);
  let end = 0;
  for (const entity of entities) {
    if (entity.offset < end) return null;
    end = entity.offset + entity.length;
  }
  let cursor = 0,
    directlyMentioned = false;
  for (const entity of entities) {
    if (text.slice(cursor, entity.offset).trim()) break;
    cursor = entity.offset + entity.length;
    directlyMentioned ||= entity.uid === botId;
  }
  return directlyMentioned ? exactCommand(text.slice(cursor)) : null;
}
