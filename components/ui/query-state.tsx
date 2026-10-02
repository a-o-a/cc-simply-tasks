import { Button } from "./button";

export function LoadingState({ message = "불러오는 중…" }: { message?: string }) {
  return (
    <div role="status" className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
      <p>{message}</p>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>다시 시도</Button>
    </div>
  );
}
