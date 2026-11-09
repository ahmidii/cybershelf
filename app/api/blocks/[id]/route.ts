import { authenticated, handled, json, sameOrigin } from '@/lib/server/http';
import { database } from '@/lib/server/storage';
export const dynamic = 'force-dynamic';
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request), { id } = await context.params;
  await database().prepare('DELETE FROM reader_blocks WHERE id=? AND blocker_id=?').bind(id, user.userId).run();
  return json({ blocked: false });
}); }
