/// <reference path="./.sst/platform/config.d.ts" />

// First deploy target is the staging domain. At cutover, set this to
// "l.ajm.codes" and use `sst.aws.dns({ override: true })` to replace the
// production record.
const domainName = "l-next.ajm.codes";

export default $config({
  app(input) {
    return {
      name: "yumi-to",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          region: "us-east-1",
        },
      },
    };
  },
  async run() {
    const table = new sst.aws.Dynamo("Shortlinks", {
      fields: {
        pk: "string",
        sk: "string",
      },
      primaryIndex: { hashKey: "pk", rangeKey: "sk" },
      transform: {
        table: {
          billingMode: "PAY_PER_REQUEST",
          pointInTimeRecovery: { enabled: true },
          deletionProtectionEnabled: true,
        },
      },
    });

    const githubClientId = new sst.Secret("GithubClientId");
    const githubClientSecret = new sst.Secret("GithubClientSecret");
    const sessionPassword = new sst.Secret("SessionPassword");
    const apiKeyHash = new sst.Secret("ApiKeyHash");
    const adminGithubId = new sst.Secret("AdminGithubId");

    new sst.aws.Nuxt("Web", {
      link: [
        table,
        githubClientId,
        githubClientSecret,
        sessionPassword,
        apiKeyHash,
        adminGithubId,
      ],
      domain: {
        name: domainName,
        dns: sst.aws.dns(),
      },
      environment: {
        BASE_URL: `https://${domainName}`,
        NUXT_OAUTH_GITHUB_CLIENT_ID: githubClientId.value,
        NUXT_OAUTH_GITHUB_CLIENT_SECRET: githubClientSecret.value,
        // Behind CloudFront the request host is the Lambda URL, so the default
        // redirect_uri would not match the GitHub OAuth App callback.
        NUXT_OAUTH_GITHUB_REDIRECT_URL: `https://${domainName}/auth/github`,
        NUXT_SESSION_PASSWORD: sessionPassword.value,
        API_KEY_HASH: apiKeyHash.value,
        ADMIN_GITHUB_ID: adminGithubId.value,
      },
    });
  },
});
