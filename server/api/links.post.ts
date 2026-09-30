import { createLink } from "../utils/links";
import requireAdmin from "../utils/requireAdmin";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const short = body?.short;
  const link = body?.link;
  if (
    !short ||
    typeof short !== "string" ||
    !link ||
    typeof link !== "string"
  ) {
    throw createError({ statusCode: 400, message: "Missing parameters!" });
  }
  try {
    return await createLink({ short, link });
  } catch {
    throw createError({ statusCode: 409, message: "Short already exists" });
  }
});
