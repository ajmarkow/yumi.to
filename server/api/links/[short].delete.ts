import { deleteLink } from "../../utils/links";
import requireAdmin from "../../utils/requireAdmin";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const shortParam = getRouterParam(event, "short");
  const body = (await readBody(event).catch(() => null)) ?? {};
  const query = getQuery(event);
  const id = body?.id ?? (typeof query.id === "string" ? query.id : undefined);
  const short =
    body?.short ??
    shortParam ??
    (typeof query.short === "string" ? query.short : undefined);
  if (!id || typeof id !== "string" || !short || typeof short !== "string") {
    throw createError({ statusCode: 400, message: "Missing parameters!" });
  }
  try {
    await deleteLink(id, short);
  } catch (err: any) {
    if (err?.name === "ConditionalCheckFailedException") {
      throw createError({ statusCode: 404, message: "Shortlink not found" });
    }
    throw err;
  }
  return { ok: true };
});
