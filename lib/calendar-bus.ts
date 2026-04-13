import { EventEmitter } from "events";

/**
 * 캘린더 변경 알림용 서버 싱글톤 이벤트 버스.
 * Next.js dev HMR에서 다중 인스턴스 생성을 막기 위해 globalThis에 보관.
 */
const g = globalThis as typeof globalThis & { _calendarBus?: EventEmitter };
if (!g._calendarBus) {
  g._calendarBus = new EventEmitter();
  g._calendarBus.setMaxListeners(200); // SSE 연결 수만큼 리스너 등록되므로 여유 있게
}

export const calendarBus = g._calendarBus;

/** 캘린더 데이터 변경 시 호출. 연결된 모든 SSE 클라이언트에 refresh 신호 전송. */
export function emitCalendarChanged() {
  calendarBus.emit("changed");
}
