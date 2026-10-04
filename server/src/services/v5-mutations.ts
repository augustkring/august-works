import type { Db } from "@paperclipai/db";
import { publishActivity, type ActivityPublication } from "./activity-log.js";

/** Keep mutation audit rows atomic and publish live updates only after commit. */
export async function withV5ActivityTransaction<T>(db: Db, work: (tx: Db, publications: ActivityPublication[]) => Promise<T>, parentPublications?: ActivityPublication[]): Promise<T> {
  if (parentPublications) return work(db, parentPublications);
  const publications: ActivityPublication[] = [];
  const result = await db.transaction((tx) => work(tx as unknown as Db, publications));
  for (const publication of publications) publishActivity(publication);
  return result;
}
