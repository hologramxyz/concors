/* global Terminal, FitAddon */
// Bundled into the isolated terminal document; no network, storage, or application tokens.
(() => {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    scrollback: 1000,
    screenReaderMode: true,
    disableStdin: true,
    theme: { background: "#151714", foreground: "#ededed", cursor: "#a6bdff", blue: "#a6bdff" },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById("terminal"));
  const send = (message) => {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else window.parent.postMessage(message, "*");
  };
  const dimensions = () => {
    const size = fit.proposeDimensions();
    if (size)
      send({
        type: "resize",
        cols: Math.max(10, Math.min(240, size.cols)),
        rows: Math.max(2, Math.min(100, size.rows)),
      });
  };
  const receive = (command) => {
    switch (command.type) {
      case "reset":
        term.resize(command.cols, command.rows);
        term.write("\x1bc" + command.data);
        break;
      case "write":
        term.write(command.data);
        break;
      case "resize":
        term.resize(command.cols, command.rows);
        break;
      case "enabled":
        term.options.disableStdin = !command.value;
        break;
      case "focus":
        dimensions();
        term.focus();
        break;
    }
  };
  window.ConcorsTerminal = { receive };
  window.addEventListener("message", (event) => {
    if (event.source === window.parent && event.data?.concorsTerminal)
      receive(event.data.concorsTerminal);
  });
  term.onData((data) => {
    if (!term.options.disableStdin) send({ type: "input", data });
  });
  new ResizeObserver(dimensions).observe(document.getElementById("terminal"));
  send({ type: "ready" });
  dimensions();
})();
