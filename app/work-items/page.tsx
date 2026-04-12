import { WorkItemsClient } from "@/components/work-items/work-items-client";

/**
 * 작업 페이지 — Phase 4 Step 4.
 * 모든 데이터 페칭/뮤테이션은 클라이언트에서 일어나므로 페이지는 shell만.
 */
export default function WorkItemsPage() {
  return <WorkItemsClient />;
}
