export default async function requireAdmin(event: any) {
  const session = await requireUserSession(event);
  const adminId = process.env.ADMIN_GITHUB_ID ?? "";
  const githubId = String((session.user as any)?.githubId ?? "");
  if (!adminId || githubId !== String(adminId)) {
    throw createError({ statusCode: 403, message: "Forbidden" });
  }
  return session;
}
