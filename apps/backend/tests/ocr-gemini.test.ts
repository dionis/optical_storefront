import {
  DEFAULT_GEMINI_OCR_MODEL,
  GeminiApiError,
  buildGeminiRequest,
  geminiUsage,
  parseGeminiReading,
  readWithGemini,
  resolveOcrProvider,
} from "../src/lib/ocr-gemini";
import { securityAudit } from "../src/lib/security";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

const READING = {
  od: { sph: -1.25, cyl: -0.5, axis: 165, add: null, prism: null, base: null },
  os: { sph: -1, cyl: null, axis: null, add: null, prism: null, base: null },
  pd: 63,
  pd_od: null,
  pd_os: null,
};

const okBody = (text: string, finishReason = "STOP") => ({
  candidates: [{ finishReason, content: { parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 110, thoughtsTokenCount: 400 },
});

describe("resolveOcrProvider", () => {
  it("keeps Anthropic first when its key is set, even with a Gemini key", () => {
    expect(resolveOcrProvider(env({ ANTHROPIC_API_KEY: "sk-ant-x", GEMINI_API_KEY: "g" }))).toEqual({
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
  });

  it("falls back to Gemini only when Anthropic has no key", () => {
    expect(resolveOcrProvider(env({ ANTHROPIC_API_KEY: "  ", GEMINI_API_KEY: "g-key" }))).toEqual({
      provider: "gemini",
      apiKey: "g-key",
      model: DEFAULT_GEMINI_OCR_MODEL,
      escalationModel: null,
    });
  });

  it("accepts GOOGLE_API_KEY and the model overrides", () => {
    expect(
      resolveOcrProvider(
        env({ GOOGLE_API_KEY: '"g2"', OCR_GEMINI_MODEL: "gemini-3-flash-preview", OCR_GEMINI_ESCALATION_MODEL: "gemini-3.1-pro-preview" })
      )
    ).toEqual({ provider: "gemini", apiKey: "g2", model: "gemini-3-flash-preview", escalationModel: "gemini-3.1-pro-preview" });
    expect(resolveOcrProvider(env({ GEMINI_API_KEY: "g", OCR_GEMINI_ESCALATION_MODEL: "none" }))?.provider).toBe("gemini");
    expect(
      (resolveOcrProvider(env({ GEMINI_API_KEY: "g", OCR_GEMINI_ESCALATION_MODEL: "none" })) as { escalationModel: string | null })
        .escalationModel
    ).toBeNull();
  });

  it("returns null with neither key", () => {
    expect(resolveOcrProvider(env({}))).toBeNull();
  });
});

describe("Gemini request and response", () => {
  it("sends the image inline with a JSON response schema", () => {
    const body = buildGeminiRequest("SYS", "image/jpeg", "AAAA") as any;
    expect(body.systemInstruction.parts[0].text).toBe("SYS");
    expect(body.contents[0].parts[0]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "AAAA" } });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.required).toEqual(["od", "os", "pd", "pd_od", "pd_os"]);
  });

  it("parses the reading and skips thought parts", () => {
    const body = {
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "thinking…", thought: true }, { text: JSON.stringify(READING) }] } },
      ],
    };
    expect(parseGeminiReading(body)).toEqual(READING);
  });

  it("treats blocked, truncated and non-JSON answers as unreadable", () => {
    expect(parseGeminiReading({ promptFeedback: { blockReason: "SAFETY" } })).toBeNull();
    expect(parseGeminiReading(okBody(JSON.stringify(READING), "MAX_TOKENS"))).toBeNull();
    expect(parseGeminiReading(okBody("not json"))).toBeNull();
    expect(parseGeminiReading({ candidates: [] })).toBeNull();
  });

  it("bills thinking tokens as output", () => {
    expect(geminiUsage(okBody("{}"))).toEqual({ input_tokens: 1500, output_tokens: 510 });
    expect(geminiUsage({})).toEqual({ input_tokens: null, output_tokens: null });
  });
});

describe("readWithGemini", () => {
  const fakeFetch = (status: number, body: unknown) =>
    jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("calls generateContent with the key in a header and reports usage", async () => {
    const f = fakeFetch(200, okBody(JSON.stringify(READING)));
    const onUsage = jest.fn();
    const out = await readWithGemini("g-key", "gemini-3.1-pro-preview", "SYS", "image/png", "AAAA", onUsage, f);
    expect(out).toEqual(READING);
    expect(onUsage).toHaveBeenCalledWith({ input_tokens: 1500, output_tokens: 510 });
    const [url, init] = (f as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent");
    expect(url).not.toContain("g-key");
    expect(init.headers["x-goog-api-key"]).toBe("g-key");
  });

  it("throws a status-carrying error on an HTTP failure", async () => {
    const f = fakeFetch(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } });
    await expect(readWithGemini("bad", "m", "S", "image/png", "A", undefined, f)).rejects.toMatchObject({
      status: 400,
      type: "INVALID_ARGUMENT",
      message: expect.stringContaining("API key not valid"),
    });
    await expect(readWithGemini("bad", "m", "S", "image/png", "A", undefined, f)).rejects.toBeInstanceOf(GeminiApiError);
  });
});

describe("security check for the prescription reader", () => {
  const ocrCheck = (vars: Record<string, string>) => securityAudit(env(vars)).checks.find((c) => c.key === "ocr.api_key");

  it("passes with either key and says which provider reads", () => {
    expect(ocrCheck({ ANTHROPIC_API_KEY: "sk-ant-x" })).toMatchObject({ ok: true, detail: "anthropic" });
    expect(ocrCheck({ GEMINI_API_KEY: "g" })).toMatchObject({ ok: true, detail: "gemini" });
    expect(ocrCheck({})).toMatchObject({ ok: false, detail: "unset" });
  });
});
