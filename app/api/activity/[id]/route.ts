import { authenticated, handled, HttpError, json, sameOrigin } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
import { idSchema } from '@/lib/server/validation';

export const dynamic = 'force-dynamic';
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request), { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw new HttpError(404, 'Update not found.');
  const result = await database().prepare('DELETE FROM reader_activity WHERE id=? AND owner_id=?').bind(id, user.userId).run();
  if (!result.meta.changes) throw new HttpError(404, 'Update not found.');
  return json({ removed: true });
}); }
