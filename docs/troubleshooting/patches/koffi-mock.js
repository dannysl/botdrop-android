// Mock koffi module for platforms where native module is unavailable (e.g. Android/Termux)
// koffi is only used by @mariozechner/pi-tui for loading kernel32.dll on Windows (TUI feature)
// pi-tui already has a fallback for when koffi is unavailable
module.exports = {
  load() {
    throw new Error("koffi native module not available on this platform");
  }
};
