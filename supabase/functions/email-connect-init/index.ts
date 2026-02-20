import { requireUser, requireWorkspaceMember } from "../_shared/auth.ts";
import { badRequest, ok, optionsResponse } from "../_shared/http.ts";

const OAUTH_CONFIG: Record<string, { authorizeUrl?: string; clientIdEnv?: string; scope?: string }> = {
  gmail: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    clientIdEnv: "EMAIL_GMAIL_CLIENT_ID",
    scope: "openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send",
  },
  outlook: {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    clientIdEnv: "EMAIL_OUTLOOK_CLIENT_ID",
    scope: "offline_access User.Read Mail.ReadWrite Mail.Send",
  },
  apple: {
    authorizeUrl: "https://appleid.apple.com/auth/authorize",
    clientIdEnv: "EMAIL_APPLE_CLIENT_ID",
    scope: "name email",
  },
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return badRequest("method_not_allowed", "Only POST is supported", 405);

  try {
    const body = await request.json();
    const { userId, supabaseAdmin } = await requireUser(request, body);
    const provider = String(body?.provider ?? "").toLowerCase();
    const workspaceId = String(body?.workspaceId ?? "");

    if (!provider || !workspaceId) {
      return badRequest("invalid_input", "provider and workspaceId are required");
    }

    await requireWorkspaceMember(supabaseAdmin, workspaceId, userId);

    if (provider === "custom") {
      return ok({ requiredFields: ["emailAddress", "smtpHost", "smtpPort", "smtpUsername", "smtpPassword"] });
    }

    if (!(provider in OAUTH_CONFIG)) {
      return badRequest("provider_unsupported", "Unsupported provider");
    }

    const config = OAUTH_CONFIG[provider]!;
    const clientId = config.clientIdEnv ? Deno.env.get(config.clientIdEnv) : null;
    const redirectUri = Deno.env.get("EMAIL_OAUTH_REDIRECT_URI");

    if (!config.authorizeUrl || !clientId || !redirectUri) {
      return ok({ requiredFields: ["emailAddress", "displayName", "accessToken", "refreshToken"] });
    }

    const state = crypto.randomUUID();
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", config.scope ?? "openid email");
    if (provider === "apple") {
      url.searchParams.set("response_mode", "form_post");
      url.searchParams.set("nonce", crypto.randomUUID());
    }

    return ok({ authUrl: url.toString(), state });
  } catch (error) {
    return badRequest("connect_init_failed", (error as Error).message, 401);
  }
});
