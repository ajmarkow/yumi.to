import { updateLink } from "../../utils/links";
import requireAdmin from "../../utils/requireAdmin";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const shortParam = getRouterParam(event, "short");
  const body = await readBody(event);
  const id = body?.id;
  const short = body?.short ?? shortParam;
  const link = body?.link;
  if (
    !id ||
    typeof id !== "string" ||
    !short ||
    typeof short !== "string" ||
    !link ||
    typeof link !== "string"
  ) {
    throw createError({ statusCode: 400, message: "Missing parameters!" });
  }
  const updated = await updateLink(id, { short, link });
  if (!updated) {
    throw createError({ statusCode: 404, message: "Shortlink not found" });
  }
  return updated;
});
