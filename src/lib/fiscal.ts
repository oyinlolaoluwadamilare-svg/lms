import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { fiscalYears } from '@/db/schema';

export async function getFiscalYearId(year: number): Promise<string> {
  const [fy] = await db.select().from(fiscalYears).where(eq(fiscalYears.year, year)).limit(1);
  if (!fy) throw new Error(`Fiscal year ${year} is not set up.`);
  return fy.id;
}
