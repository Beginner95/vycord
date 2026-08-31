// Injected before any page script (CDP addScriptToEvaluateOnNewDocument):
// records every WebSocket the app opens, so a smoke run can push a synthetic
// server frame through the REAL wsService.onmessage -> AppPage handler ->
// zustand/state -> ChannelSidebar render path, without needing the SFU.
(() => {
  const Native = window.WebSocket;
  window.__sockets = [];
  function Patched(...args) {
    const ws = new Native(...args);
    window.__sockets.push(ws);
    return ws;
  }
  Patched.prototype = Native.prototype;
  Object.assign(Patched, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Patched;

  // Fire a server-shaped frame at every live socket. wsService binds via
  // addEventListener('message'), not .onmessage, so dispatchEvent is what
  // actually reaches it — and it also covers an .onmessage handler.
  window.__pushWS = (type, payload) => {
    const data = JSON.stringify({ type, payload });
    let n = 0;
    for (const ws of window.__sockets) {
      if (ws.readyState === 1) {
        ws.dispatchEvent(new MessageEvent('message', { data }));
        n++;
      }
    }
    return n;
  };
})();
