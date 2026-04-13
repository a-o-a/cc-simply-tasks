import { calendarBus } from "@/lib/calendar-bus";

export const dynamic = "force-dynamic";

/**
 * GET /api/calendar-events/stream
 * Server-Sent Events 엔드포인트.
 * 캘린더 데이터가 변경되면 연결된 모든 클라이언트에 "data: refresh\n\n"를 전송.
 * 클라이언트는 이 신호를 받으면 캘린더 이벤트를 재조회한다.
 *
 * - 25초마다 heartbeat(: ping) 전송 → 프록시/방화벽 타임아웃 방지
 * - EventSource는 연결이 끊기면 자동 재연결
 */
export async function GET() {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        try {
          controller.enqueue(encoder.encode("data: refresh\n\n"));
        } catch {
          cleanup?.();
        }
      };

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup?.();
        }
      }, 25_000);

      calendarBus.on("changed", send);

      cleanup = () => {
        calendarBus.off("changed", send);
        clearInterval(heartbeat);
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
