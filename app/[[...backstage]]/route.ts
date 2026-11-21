import { env } from "cloudflare:workers";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "../chatgpt-auth";
import { handleRequest } from "../../src/app.mjs";
import { errorPage } from "../../src/view.mjs";

export const dynamic = "force-dynamic";

async function respond(request: Request) {
  const path = new URL(request.url).pathname;
  try {
    const user = path === "/" || path === "/bands" || path.startsWith("/bands/")
      ? await getChatGPTUser()
      : null;
    return await handleRequest(request, {
      env,
      user,
      signIn: chatGPTSignInPath(path),
      signOut: chatGPTSignOutPath(),
    });
  } catch {
    return errorPage(500, "Something went wrong", "Try reloading the page.");
  }
}

export const GET = respond;
export const POST = respond;
