/**
 * The app takes file drops through ordinary HTML drop events (Tauri's native drop handler is off,
 * see tauri.conf.json), so a file dropped anywhere that does not accept it would make the webview
 * open the file in place of the app. Drops nobody handled are cancelled here, and the cursor says
 * so while dragging. Drop targets such as the composer accept files by cancelling `dragover`
 * themselves before the event reaches the document.
 */
export function carriesFiles(data: Pick<DataTransfer, "types"> | null) {
  return !!data && Array.from(data.types).includes("Files");
}

export function guardFileDrops() {
  document.addEventListener("dragover", (event) => {
    if (event.defaultPrevented || !carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  });
  document.addEventListener("drop", (event) => {
    if (carriesFiles(event.dataTransfer)) event.preventDefault();
  });
}
