import { signupEventOf, signupOutcomeOf } from "#/lib/embedded-signup.ts";
import type { SignupEvent, SignupOutcome } from "#/lib/embedded-signup.ts";

// Meta's Embedded Signup v4, launched from the WhatsApp settings through
// Facebook's JavaScript SDK
// (https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation).
// The SDK is loaded when the page shows the button, so the click opens the
// popup at once: a popup opened after an await is blocked by the browser.

interface LoginResponse {
  authResponse?: { code?: string } | null;
}

interface FacebookSdk {
  init(options: {
    appId: string;
    autoLogAppEvents: boolean;
    xfbml: boolean;
    version: string;
  }): void;
  login(
    callback: (response: LoginResponse) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: { setup: Record<string, never> };
    },
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const sdkVersion = "v26.0";

/** How long to wait for the popup's message once `FB.login` returned the code, which lasts 30 seconds. */
const messageWait = 10_000;

let loading: Promise<FacebookSdk> | null = null;

/** Loads Facebook's SDK once, initialized with underthing's app. */
export function loadFacebookSdk(appId: string): Promise<FacebookSdk> {
  loading ??= new Promise<FacebookSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      const sdk = window.FB;
      if (!sdk) {
        reject(new Error("Facebook's SDK loaded without FB"));
        return;
      }
      sdk.init({ appId, autoLogAppEvents: true, xfbml: false, version: sdkVersion });
      resolve(sdk);
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      loading = null;
      reject(new Error("Facebook's SDK did not load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Opens the signup popup and resolves once the admin finished, cancelled or
 * hit an error: completed only with both the code and the number.
 */
export function runEmbeddedSignup(sdk: FacebookSdk, configurationId: string) {
  return new Promise<SignupOutcome>((resolve) => {
    let event: SignupEvent | null = null;
    let code: string | null | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function settle() {
      if (code === undefined) {
        return;
      }
      const outcome = signupOutcomeOf(code, event);
      if (outcome) {
        finish(outcome);
      } else {
        // The code came first: the popup's message follows.
        timer ??= setTimeout(() => finish({ kind: "failed", message: null }), messageWait);
      }
    }

    function onMessage(message: MessageEvent) {
      const read = signupEventOf(message.origin, message.data);
      if (read) {
        event = read;
        settle();
      }
    }

    function finish(outcome: SignupOutcome) {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(outcome);
    }

    window.addEventListener("message", onMessage);
    sdk.login(
      (response) => {
        code = response.authResponse?.code ?? null;
        settle();
      },
      {
        config_id: configurationId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  });
}
