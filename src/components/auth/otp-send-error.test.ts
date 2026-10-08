import { AUTH_CODE_VALID_MINUTES } from "@email/templates/auth-code";
import { describe, expect, it } from "@rstest/core";

import {
  describeOtpSendError,
  formatCountdown,
  OTP_INVITE_ONLY_MESSAGE,
  OTP_SEND_FAILED_MESSAGE,
  OTP_TOO_MANY_MESSAGE,
  OTP_VALID_MINUTES,
} from "./otp-send-error";

describe("describeOtpSendError", () => {
  it("turns Auth's per-address wait into our countdown copy", () => {
    expect(
      describeOtpSendError({
        message: "For security purposes, you can only request this after 42 seconds.",
        code: "over_email_send_rate_limit",
        status: 429,
      }),
    ).toEqual({
      kind: "wait",
      seconds: 42,
      message: "You can ask for another code in 42 seconds.",
    });
    expect(describeOtpSendError({ message: "… only request this after 1 second." })).toMatchObject({
      seconds: 1,
      message: "You can ask for another code in 1 second.",
    });
  });

  it("never shows Supabase's raw rate-limit text", () => {
    for (const error of [
      { message: "email rate limit exceeded", code: "over_email_send_rate_limit", status: 429 },
      { message: "Request rate limit reached", code: "over_request_rate_limit", status: 429 },
      { message: "Too Many Requests", status: 429 },
    ]) {
      expect(describeOtpSendError(error)).toEqual({
        kind: "message",
        message: OTP_TOO_MANY_MESSAGE,
      });
    }
  });

  it("says the code couldn't be sent when the hook or the mailer fails", () => {
    for (const error of [
      { message: "Error sending magic link email", code: "unexpected_failure", status: 500 },
      { message: "email_send_failed", status: 500 },
      {
        message: "Failed to reach hook within maximum time of 5.000000 seconds",
        code: "hook_timeout",
        status: 500,
      },
    ]) {
      expect(describeOtpSendError(error)).toEqual({
        kind: "message",
        message: OTP_SEND_FAILED_MESSAGE,
      });
    }
  });

  it("keeps the invite-only guidance for an unconfirmed address", () => {
    expect(
      describeOtpSendError({
        message: "Signups not allowed for this instance",
        code: "signup_disabled",
        status: 422,
      }),
    ).toEqual({ kind: "message", message: OTP_INVITE_ONLY_MESSAGE });
  });

  it("passes anything else through", () => {
    expect(
      describeOtpSendError({
        message: "Unable to validate email address: invalid format",
        status: 400,
      }),
    ).toEqual({
      kind: "message",
      message: "Unable to validate email address: invalid format",
    });
  });
});

describe("formatCountdown", () => {
  it("shows minutes and two-digit seconds", () => {
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(59)).toBe("0:59");
    expect(formatCountdown(5.2)).toBe("0:06");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});

it("the screen and the email name the same code lifetime", () => {
  expect(OTP_VALID_MINUTES).toBe(AUTH_CODE_VALID_MINUTES);
});
