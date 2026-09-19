import "dotenv/config";
import { deepseek } from "@ai-sdk/deepseek";

// Direct provider (user has a DeepSeek key). Model id comes from env so it can be swapped without code changes.
export const modelId = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
export const model = () => deepseek(modelId);

// Thinking mode rejects forced tool_choice and adds latency. Agents here are tool-call routers, so disable it.
export const providerOptions = { deepseek: { thinking: { type: "disabled" as const } } };
