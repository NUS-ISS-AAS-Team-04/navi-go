import type { z } from "zod";

export class FakeStructuredChatModel {
  public constructor(
    private readonly outputs:
      | Record<string, unknown>
      | ((key: string, prompt: string) => unknown),
  ) {}

  public withStructuredOutput<TReturn extends Record<string, unknown>>(
    schema: z.ZodType<TReturn>,
    config?: { name?: string },
  ): { invoke: (prompt: string) => Promise<TReturn> } {
    const key = config?.name ?? "default";

    return {
      invoke: async (prompt: string) => {
        const output =
          typeof this.outputs === "function"
            ? this.outputs(key, prompt)
            : this.outputs[key];
        return schema.parse(output);
      },
    };
  }
}
