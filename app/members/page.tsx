import { MembersClient } from "./members-client";

/**
 * 멤버 관리 — Phase 4 Step 3.
 * 데이터 페칭/뮤테이션이 모두 클라이언트에서 일어나기 때문에
 * 페이지 자체는 단순한 server-component shell만 둔다.
 */
export default function MembersPage() {
  return <MembersClient />;
}
