/// <reference path="./.sst/platform/config.d.ts" />

// First deploy target is the staging domain. At cutover change this to
// "l.ajm.codes" (do not add `override: true` until the real cutover).
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
    const accountId = "209255852435";

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
        // Not managing DNS records yet: at cutover, switch the domainName
        // constant to "l.ajm.codes" and let SST manage the Route 53 record.
        dns: false,
      },
      environment: {
        BASE_URL: `https://${domainName}`,
        AWS_ACCOUNT_ID: accountId,
        NUXT_OAUTH_GITHUB_CLIENT_ID: githubClientId.value,
        NUXT_OAUTH_GITHUB_CLIENT_SECRET: githubClientSecret.value,
        NUXT_SESSION_PASSWORD: sessionPassword.value,
        API_KEY_HASH: apiKeyHash.value,
        ADMIN_GITHUB_ID: adminGithubId.value,
      },
    });
  },
});
