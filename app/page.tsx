import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * 임시 홈 화면 — Phase 4 Step 1 design system smoke test.
 * 실제 대시보드는 Phase 4 후반에 작성한다.
 */
export default function Home() {
  return (
    <main className="container mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            cc-simply-tasks
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            내부용 작업 관리 시스템 — 디자인 시스템 부트스트랩 완료
          </p>
        </div>
        <ThemeToggle />
      </div>

      <section className="mt-10 space-y-4 rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold">버튼 시안</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-5 gap-3">
        <StatusChip label="DRAFT" colorVar="--status-draft" />
        <StatusChip label="IN_PROGRESS" colorVar="--status-in-progress" />
        <StatusChip label="READY" colorVar="--status-ready" />
        <StatusChip label="TRANSFERRED" colorVar="--status-transferred" />
        <StatusChip label="CANCELED" colorVar="--status-canceled" />
      </section>
    </main>
  );
}

function StatusChip({ label, colorVar }: { label: string; colorVar: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs font-medium"
      style={{ color: `hsl(var(${colorVar}))` }}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: `hsl(var(${colorVar}))` }}
      />
      {label}
    </div>
  );
}
