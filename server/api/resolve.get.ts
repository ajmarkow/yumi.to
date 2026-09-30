import { getExact, getUniquePrefix } from "../utils/links";

export default defineEventHandler(async (event) => {
  const { path } = getQuery(event);
  const short = typeof path === "string" ? path : "";
  const exact = await getExact(short);
  if (exact?.link) return { link: exact.link };
  const prefixed = await getUniquePrefix(short);
  if (prefixed?.link) return { link: prefixed.link };
  return { link: null };
});
