import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useChat } from "@/stores/chat";

/**
 * The input, in the admin assistant's shape: one rounded row on the frame
 * colour, the field growing with the question and a square brand button on the
 * end that turns into stop while a query runs. Enter sends, Shift+Enter breaks
 * a line.
 */
export function Composer() {
  const [value, setValue] = useState("");
  const send = useChat((state) => state.send);
  const stop = useChat((state) => state.stop);
  const streaming = useChat((state) => state.streaming);
  const area = useRef<HTMLTextAreaElement>(null);

  // `field-sizing: content` does the growing where it is supported; this keeps
  // the same behaviour in the browsers where it is not.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || CSS.supports("field-sizing", "content")) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [value]);

  function submit() {
    const text = value;
    setValue("");
    void send(text);
  }

  return (
    <form
      className="ai-bubble-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={area}
        rows={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Ask about an account, the pipeline, or a deal…"
        className="ai-bubble-input"
      />
      {streaming ? (
        <button type="button" className="ai-bubble-send" onClick={stop} aria-label="Stop the answer" title="Stop">
          <Icon icon="fa-sharp fa-solid fa-stop" />
        </button>
      ) : (
        <button type="submit" className="ai-bubble-send" disabled={value.trim().length === 0} aria-label="Send">
          <Icon icon="fa-sharp fa-solid fa-arrow-up" />
        </button>
      )}
    </form>
  );
}
