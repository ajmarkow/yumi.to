import { timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import { getExact, createLink } from "../utils/links";

function getApiKeyHash(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resource } = require("sst");
    const value = Resource.ApiKeyHash?.value;
    if (value) return String(value);
  } catch {
    /* fall through to env */
  }
  return process.env.API_KEY_HASH ?? "";
}

export default defineEventHandler(async (event) => {
  try {
    const { link } = getQuery(event);
    const { apikey } = getHeaders(event);

    if (
      !link ||
      typeof link !== "string" ||
      !apikey ||
      typeof apikey !== "string"
    ) {
      throw new Error("Missing parameters!");
    }

    const url = new URL(link);
    if (!url.protocol.includes("http")) {
      throw new Error("Invalid link! Must be a valid URL!");
    }

    const expected = getApiKeyHash();
    const a = Buffer.from(apikey);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Invalid API key!");
    }

    let short = "";
    for (;;) {
      const candidate = nanoid(2);
      const existing = await getExact(candidate);
      if (!existing) {
        short = candidate;
        break;
      }
    }

    await createLink({ short, link });

    return {
      status: 200,
      message: "Success! New short URL created!",
      newShortlink: `${process.env.BASE_URL}/${short}`,
    };
  } catch (err) {
    console.error(err);
    const error = err as Error;
    return {
      status: 500,
      message: `Error! ${error.message}`,
    };
  }
});
