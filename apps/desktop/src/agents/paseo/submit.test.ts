import { expect, it, vi } from "vitest";
import { submitAgentInput } from "./submit";

function input() {
  return {
    message: "  Follow up  ",
    attachments: [{ name: "notes.txt" }],
    canSubmit: true,
    isAgentRunning: false,
    submitBehavior: "preserve-and-lock" as const,
    queueMessage: vi.fn(),
    submitMessage: vi.fn(async () => undefined),
    clearDraft: vi.fn(),
    setUserInput: vi.fn(),
    setAttachments: vi.fn(),
    setSendError: vi.fn(),
    setIsProcessing: vi.fn(),
  };
}
it("retains the draft and attachments when delivery cannot be confirmed", async () => {
  const options = input();
  options.submitMessage.mockRejectedValue(new Error("Connection lost"));
  expect(await submitAgentInput(options)).toBe("failed");
  expect(options.clearDraft).not.toHaveBeenCalled();
  expect(options.setUserInput).not.toHaveBeenCalled();
  expect(options.setAttachments).not.toHaveBeenCalled();
  expect(options.setSendError).toHaveBeenLastCalledWith("Connection lost");
  expect(options.setIsProcessing).toHaveBeenLastCalledWith(false);
});
it("queues active-turn follow-ups but dispatches explicit receipt retries immediately", async () => {
  const options = { ...input(), isAgentRunning: true };
  expect(await submitAgentInput(options)).toBe("queued");
  expect(options.queueMessage).toHaveBeenCalledWith({
    message: "Follow up",
    attachments: options.attachments,
  });
  expect(options.submitMessage).not.toHaveBeenCalled();
  expect(await submitAgentInput({ ...options, forceSend: true })).toBe("submitted");
  expect(options.submitMessage).toHaveBeenCalledOnce();
  expect(options.clearDraft).toHaveBeenCalledWith("sent");
});
