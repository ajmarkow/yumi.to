import { Resource } from "sst";

export default defineOAuthGitHubEventHandler({
  async onSuccess(event, { user }) {
    let adminId: string;
    try {
      adminId = String(Resource.AdminGithubId.value);
    } catch {
      adminId = process.env.ADMIN_GITHUB_ID ?? "";
    }
    if (!adminId || String(user.id) !== String(adminId)) {
      throw createError({ statusCode: 403, message: "Forbidden" });
    }
    await setUserSession(event, {
      user: { githubId: user.id, login: user.login },
    });
    return sendRedirect(event, "/dashboard");
  },
});
