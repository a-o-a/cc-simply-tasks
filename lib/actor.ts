import type { NextRequest } from "next/server";
import type { ActorType } from "./enums";

export type ActorContext = {
  actorType: ActorType;
  actorName: string | null;
  actorIp: string | null;
  userAgent: string | null;
};

/**
 * 요청에서 액터 컨텍스트를 추출. 모든 write API 핸들러에서 호출.
 *
 * - actorName: 클라이언트가 x-actor-name 헤더로 전달 (localStorage 기반, 프론트 fetch interceptor).
 *              없으면 null. 1차는 인증이 없으므로 null도 허용하나,
 *              프론트에서 미설정 시 modal로 강제 입력하도록 한다.
 * - actorIp:   x-forwarded-for 첫 번째 IP 우선, 없으면 request.ip.
 * - userAgent: user-agent 헤더 그대로.
 *
 * Postgres/인증 이관 시 세션 기반 user id 추출 로직을 추가하고
 * actorType="USER" 경로를 더한다.
 */
export function getActorContext(req: NextRequest | Request): ActorContext {
  const headers = req.headers;

  const xff = headers.get("x-forwarded-for");
  const actorIp = xff
    ? xff.split(",")[0]?.trim() ?? null
    : (req as NextRequest).ip ?? null;

  const rawName = headers.get("x-actor-name");
  const decoded = rawName ? (() => { try { return decodeURIComponent(rawName); } catch { return rawName; } })() : null;
  const actorName = decoded && decoded.trim().length > 0 ? decoded.trim() : null;

  const userAgent = headers.get("user-agent");

  return {
    actorType: "ANONYMOUS",
    actorName,
    actorIp,
    userAgent,
  };
}
