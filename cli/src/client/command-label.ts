export function buildCliCommandLabel(): string {
  // Challenges persist this label and display it in the browser. Arguments
  // can contain credentials or private work, so identify only the client.
  return "paperclipai";
}
