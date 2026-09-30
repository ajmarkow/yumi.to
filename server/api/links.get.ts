import { listLinks } from "../utils/links";
import requireAdmin from "../utils/requireAdmin";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return await listLinks();
});
