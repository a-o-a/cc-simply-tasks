import { and, inArray, isNull } from "drizzle-orm";
import { ZodError, flattenError } from "zod";
import { HttpError } from "../errors";
import type { db } from "../db";
import { teamMembers } from "./schema";

type MemberReference = {
  id: string | null | undefined;
  path: Array<string | number>;
  previousId?: string | null;
};

/** Validate new assignments inside the write transaction; retain historical relationships. */
export async function assertAssignableMembers(
  tx: Pick<typeof db, "select">,
  references: MemberReference[],
): Promise<void> {
  const changed = references.filter((reference) => reference.id && reference.id !== reference.previousId);
  const ids = [...new Set(changed.map((reference) => reference.id!))];
  if (ids.length === 0) return;

  const members = await tx.select({ id: teamMembers.id }).from(teamMembers)
    .where(and(inArray(teamMembers.id, ids), isNull(teamMembers.deletedAt)));
  const activeIds = new Set(members.map((member) => member.id));
  const invalid = changed.filter((reference) => !activeIds.has(reference.id!));
  if (invalid.length > 0) {
    const error = new ZodError(invalid.map((reference) => ({
      code: "custom",
      path: reference.path,
      message: "존재하지 않거나 삭제된 팀원입니다. 담당자 목록을 새로고침해 주세요",
    })));
    throw new HttpError("VALIDATION_ERROR", "존재하지 않거나 삭제된 팀원입니다. 담당자 목록을 새로고침해 주세요", flattenError(error));
  }
}
