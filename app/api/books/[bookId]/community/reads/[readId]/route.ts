import { authenticated, handled, HttpError, json, sameOrigin } from '@/lib/server/http';
import { idSchema } from '@/lib/server/validation';
import { deleteCommunityRead } from '@/lib/server/book-community';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ bookId: string; readId: string }> };
export async function DELETE(request: Request, context: Context) { return handled(async () => {
  sameOrigin(request); const user = await authenticated(request); const { bookId, readId } = await context.params;
  if (!idSchema.safeParse(readId).success) throw new HttpError(400, 'Choose a saved completed read to remove.');
  return json(await deleteCommunityRead(bookId, user.userId, readId));
}); }
