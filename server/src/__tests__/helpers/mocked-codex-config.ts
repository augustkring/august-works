/** Only for tests whose provider adapter is replaced by a mock.
 * The credential preflight must not depend on the developer's host login. */
export const mockedCodexAdapterConfig = {
  env: { OPENAI_API_KEY: "test-mocked-adapter-not-a-provider-key" },
};
