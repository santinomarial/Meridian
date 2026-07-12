import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { AUTH_MESSAGES, getAuthErrorMessage } from "./authErrors";

describe("getAuthErrorMessage", () => {
  it("maps a 401 on login to 'Invalid email or password.'", () => {
    const err = new ApiError(401, "Invalid credentials");
    expect(getAuthErrorMessage(err, { invalidCredentialsFor401: true })).toBe(
      AUTH_MESSAGES.invalidCredentials,
    );
  });

  it("does not use the invalid-credentials message for 401 outside login", () => {
    const err = new ApiError(401, "Session expired");
    expect(getAuthErrorMessage(err)).toBe("Session expired");
  });

  it("maps 429 to the rate-limit message (never the raw throttler text)", () => {
    const err = new ApiError(429, "ThrottlerException: Too Many Requests");
    expect(getAuthErrorMessage(err)).toBe(AUTH_MESSAGES.rateLimited);
    expect(getAuthErrorMessage(err, { invalidCredentialsFor401: true })).toBe(
      AUTH_MESSAGES.rateLimited,
    );
  });

  it("maps 5xx to the server-error message", () => {
    expect(getAuthErrorMessage(new ApiError(500, "Internal server error"))).toBe(
      AUTH_MESSAGES.serverError,
    );
    expect(getAuthErrorMessage(new ApiError(503, "Service unavailable"))).toBe(
      AUTH_MESSAGES.serverError,
    );
  });

  it("passes through other 4xx backend messages (validation, conflicts)", () => {
    expect(getAuthErrorMessage(new ApiError(409, "Email already in use"))).toBe(
      "Email already in use",
    );
    expect(
      getAuthErrorMessage(new ApiError(400, "Reset link is invalid or expired.")),
    ).toBe("Reset link is invalid or expired.");
  });

  it("maps network failures (non-ApiError) to the server-unreachable message", () => {
    expect(getAuthErrorMessage(new TypeError("Failed to fetch"))).toBe(
      AUTH_MESSAGES.serverUnreachable,
    );
    expect(getAuthErrorMessage(undefined)).toBe(AUTH_MESSAGES.serverUnreachable);
  });

  it("never returns a vague 'Something went wrong'", () => {
    const samples = [
      new ApiError(401, "x"),
      new ApiError(429, "x"),
      new ApiError(500, "x"),
      new TypeError("Failed to fetch"),
      null,
    ];
    for (const err of samples) {
      expect(getAuthErrorMessage(err).toLowerCase()).not.toContain(
        "something went wrong",
      );
    }
  });
});
